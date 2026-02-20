import { FastifyInstance } from 'fastify'
import { authMiddleware, requireRole, type AuthenticatedRequest } from '../middleware/auth'
import {
  listAvailableRoutesForDriver,
  getRouteById,
  getRouteStops,
  assignRoute,
  startRoute,
  completeRoute,
  cancelRoutePreStart,
  updateStopStatus,
  getRouteStopById,
} from '../repos/routes.repo'
import { getDriverZips, findDriverById } from '../repos/drivers.repo'
import { podKey, getPresignedUrl } from '../config/s3'

const RADIUS_MILES = 25

export async function registerDriverRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (instance) => {
    instance.addHook('preHandler', authMiddleware)
    instance.addHook('preHandler', requireRole('driver'))

        instance.get('/api/v1/driver/application-status', async (request: AuthenticatedRequest, reply) => {
          const driverId = request.driverId as string | undefined
          if (!driverId) return reply.code(403).send({ error: 'Driver not linked' })
          const driver = await findDriverById(driverId)
          if (!driver) return reply.code(404).send({ error: 'Driver not found' })
          const status = (driver as any).applicationStatus ?? (driver.active ? 'approved' : 'pending_review')
          return reply.send({ status, active: driver.active })
        })

        instance.get('/api/v1/driver/routes/available', async (request: AuthenticatedRequest, reply) => {
          const driverId = request.driverId as string | undefined
          const stateId = request.stateId as string | undefined
          if (!driverId || !stateId) {
            return reply.code(403).send({ error: 'Driver not linked to state' })
          }
          const driver = await findDriverById(driverId)
          if (!driver?.active) {
            return reply.send([])
          }
          const zips = await getDriverZips(driverId)
      const driverZipList = zips.map((z) => z.zip)
      const driverZipLatLons = zips
        .filter((z) => z.lat != null && z.lon != null)
        .map((z) => ({ zip: z.zip, lat: Number(z.lat), lon: Number(z.lon) }))
      const routes = await listAvailableRoutesForDriver(
        stateId,
        driverZipList,
        driverZipLatLons,
        RADIUS_MILES
      )
      return reply.send(routes)
    })

    instance.get<{ Params: { id: string } }>(
      '/api/v1/driver/routes/:id',
      async (request: AuthenticatedRequest, reply) => {
        const params = request.params as { id: string }
        const route = await getRouteById(params.id)
        if (!route) return reply.code(404).send({ error: 'Route not found' })
        if (route.assigned_driver_id !== request.driverId) {
          return reply.code(403).send({ error: 'Not your route' })
        }
        const stops = await getRouteStops(route.id)
        return reply.send({ ...route, stops })
      }
    )

    instance.post<{ Params: { id: string } }>(
      '/api/v1/driver/routes/:id/accept',
      async (request: AuthenticatedRequest, reply) => {
        const params = request.params as { id: string }
        const route = await getRouteById(params.id)
        if (!route) return reply.code(404).send({ error: 'Route not found' })
        if (route.status !== 'available') {
          return reply.code(400).send({ error: 'Route not available' })
        }
        const driverId = request.driverId!
        const ok = await assignRoute(route.id, driverId)
        if (!ok) return reply.code(400).send({ error: 'Could not accept route' })
        return reply.send({ ok: true })
      }
    )

    instance.post<{ Params: { id: string } }>(
      '/api/v1/driver/routes/:id/start',
      async (request: AuthenticatedRequest, reply) => {
        const params = request.params as { id: string }
        const route = await getRouteById(params.id)
        if (!route) return reply.code(404).send({ error: 'Route not found' })
        if (route.assigned_driver_id !== request.driverId) {
          return reply.code(403).send({ error: 'Not your route' })
        }
        const ok = await startRoute(route.id, request.driverId!)
        if (!ok) return reply.code(400).send({ error: 'Could not start route' })
        return reply.send({ ok: true })
      }
    )

    instance.post<{ Params: { id: string } }>(
      '/api/v1/driver/routes/:id/complete',
      async (request: AuthenticatedRequest, reply) => {
        const params = request.params as { id: string }
        const route = await getRouteById(params.id)
        if (!route) return reply.code(404).send({ error: 'Route not found' })
        if (route.assigned_driver_id !== request.driverId) {
          return reply.code(403).send({ error: 'Not your route' })
        }
        const ok = await completeRoute(route.id, request.driverId!)
        if (!ok) return reply.code(400).send({ error: 'Could not complete route' })
        return reply.send({ ok: true })
      }
    )

    instance.post<{ Params: { id: string } }>(
      '/api/v1/driver/routes/:id/cancel',
      async (request: AuthenticatedRequest, reply) => {
        const params = request.params as { id: string }
        const route = await getRouteById(params.id)
        if (!route) return reply.code(404).send({ error: 'Route not found' })
        if (route.assigned_driver_id !== request.driverId) {
          return reply.code(403).send({ error: 'Not your route' })
        }
        const ok = await cancelRoutePreStart(route.id)
        if (!ok) return reply.code(400).send({ error: 'Can only cancel before start' })
        return reply.send({ ok: true })
      }
    )

    instance.get<{ Params: { routeId: string; stopId: string } }>(
      '/api/v1/driver/routes/:routeId/stops/:stopId/nav-url',
      async (request: AuthenticatedRequest, reply) => {
        const params = request.params as { routeId: string; stopId: string }
        const route = await getRouteById(params.routeId)
        if (!route || route.assigned_driver_id !== request.driverId) {
          return reply.code(404).send({ error: 'Not found' })
        }
        const stop = await getRouteStopById(params.stopId)
        if (!stop || stop.route_id !== route.id) {
          return reply.code(404).send({ error: 'Stop not found' })
        }
        const addr = [stop.address_line1, stop.address_city, stop.address_state, stop.address_zip]
          .filter(Boolean)
          .join(', ')
        const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}`
        return reply.send({ url })
      }
    )

    instance.post<{
      Params: { routeId: string; stopId: string }
      Body: { status: 'completed' | 'failed'; podS3Key?: string }
    }>(
      '/api/v1/driver/routes/:routeId/stops/:stopId/complete',
      async (request: AuthenticatedRequest, reply) => {
        const params = request.params as { routeId: string; stopId: string }
        const route = await getRouteById(params.routeId)
        if (!route || route.assigned_driver_id !== request.driverId) {
          return reply.code(404).send({ error: 'Not found' })
        }
        const stop = await getRouteStopById(params.stopId)
        if (!stop || stop.route_id !== route.id) {
          return reply.code(404).send({ error: 'Stop not found' })
        }
        const body = request.body as { status?: 'completed' | 'failed'; podS3Key?: string }
        const status = body?.status || 'completed'
        const ok = await updateStopStatus(params.stopId, status, body?.podS3Key)
        if (!ok) return reply.code(400).send({ error: 'Update failed' })
        return reply.send({ ok: true })
      }
    )

    instance.get<{ Params: { routeId: string; stopId: string } }>(
      '/api/v1/driver/routes/:routeId/stops/:stopId/upload-url',
      async (request: AuthenticatedRequest, reply) => {
        const params = request.params as { routeId: string; stopId: string }
        const route = await getRouteById(params.routeId)
        if (!route || route.assigned_driver_id !== request.driverId) {
          return reply.code(404).send({ error: 'Not found' })
        }
        const stop = await getRouteStopById(params.stopId)
        if (!stop || stop.route_id !== route.id) {
          return reply.code(404).send({ error: 'Stop not found' })
        }
        const filename = `pod-${Date.now()}.jpg`
        const key = podKey(route.id, stop.id, filename)
        const url = getPresignedUrl(key, 'putObject', 900)
        return reply.send({ url, key })
      }
    )
  })
}
