import { FastifyInstance } from 'fastify'
import { authMiddleware, requireRole, requireStateScope, type AuthenticatedRequest } from '../middleware/auth'
import {
  listRoutesByState,
  getRouteById,
  getRouteStops,
  assignRoute,
} from '../repos/routes.repo'
import * as driversRepo from '../repos/drivers.repo'
import { driverCanTakeRoute } from '../services/guardrails.service'
import { findApprovedOverride, createOverrideRequest, approveOverride } from '../repos/override.repo'
import { ZipCentroid } from '../models/ZipCentroid'

export async function registerRoutesRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (instance) => {
    instance.addHook('preHandler', authMiddleware)
    instance.addHook('preHandler', requireRole('admin', 'manager', 'dispatcher'))

    instance.get<{ Querystring: { stateId: string; status?: string } }>(
      '/api/v1/routes',
      async (request: AuthenticatedRequest, reply) => {
        const q = request.query as { stateId?: string }
        const h = request.headers['x-state-id']
        const stateIdRaw = q?.stateId ?? (Array.isArray(h) ? h[0] : h)
        const stateId = typeof stateIdRaw === 'string' ? stateIdRaw : null
        if (!stateId) return reply.code(400).send({ error: 'stateId required' })
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== stateId) {
          return reply.code(403).send({ error: 'State not in scope' })
        }
        const status = (request.query as { status?: string }).status as
          | 'available'
          | 'assigned'
          | 'in_progress'
          | 'completed'
          | undefined
        const routes = await listRoutesByState(stateId, status)
        return reply.send(routes)
      }
    )

    instance.get<{ Params: { id: string } }>(
      '/api/v1/routes/:id',
      async (request: AuthenticatedRequest, reply) => {
        const params = request.params as { id: string }
        const route = await getRouteById(params.id)
        if (!route) return reply.code(404).send({ error: 'Route not found' })
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== route.state_id) {
          return reply.code(403).send({ error: 'State not in scope' })
        }
        const stops = await getRouteStops(route.id)
        return reply.send({ ...route, stops })
      }
    )

    instance.post<{
      Params: { id: string }
      Body: { driverId: string; overrideApproved?: boolean }
    }>('/api/v1/routes/:id/assign', async (request: AuthenticatedRequest, reply) => {
      const params = request.params as { id: string }
      const route = await getRouteById(params.id)
      if (!route) return reply.code(404).send({ error: 'Route not found' })
      const scope = requireStateScope(request)
      if (request.role !== 'admin' && scope !== route.state_id) {
        return reply.code(403).send({ error: 'State not in scope' })
      }
      const body = request.body as { driverId?: string; overrideApproved?: boolean }
      const driverId = body?.driverId
      if (!driverId) return reply.code(400).send({ error: 'driverId required' })
      const allowed = await driverCanTakeRoute(driverId, route.id)
      if (!allowed) {
        const hasOverride = await findApprovedOverride(
          route.state_id,
          'route_assign',
          route.id,
          driverId
        )
        if (!hasOverride) {
          return reply.code(400).send({
            error: 'Driver ZIP coverage does not match route (ZIP or 25 mi). Create override request for manager approval.',
          })
        }
      }
      const ok = await assignRoute(route.id, driverId)
      if (!ok) return reply.code(400).send({ error: 'Route not available for assignment' })
      return reply.send({ ok: true })
    })

    instance.post<{
      Body: { routeId: string; driverId: string; reason?: string }
    }>('/api/v1/override-requests', async (request: AuthenticatedRequest, reply) => {
      const body = request.body as { routeId?: string; driverId?: string; reason?: string }
      if (!body?.routeId || !body?.driverId) {
        return reply.code(400).send({ error: 'routeId and driverId required' })
      }
      const routeId = body.routeId
      const route = await getRouteById(routeId)
      if (!route) return reply.code(404).send({ error: 'Route not found' })
      const scope = requireStateScope(request)
      if (request.role !== 'admin' && scope !== route.state_id) {
        return reply.code(403).send({ error: 'State not in scope' })
      }
      const id = await createOverrideRequest({
        stateId: route.state_id,
        requestedBy: request.userId!,
        entityType: 'route_assign',
        entityId: route.id,
        driverId: body.driverId,
        reason: body.reason,
      })
      return reply.send({ id, status: 'pending' })
    })

    instance.patch<{ Params: { id: string } }>(
      '/api/v1/override-requests/:id/approve',
      async (request: AuthenticatedRequest, reply) => {
        const params = request.params as { id: string }
        const managerId = request.userId
        if (!managerId) return reply.code(401).send({ error: 'Unauthorized' })
        if (request.role !== 'admin' && request.role !== 'manager') {
          return reply.code(403).send({ error: 'Manager or Admin only' })
        }
        const ok = await approveOverride(params.id, managerId)
        if (!ok) return reply.code(404).send({ error: 'Override not found or already processed' })
        return reply.send({ ok: true })
      }
    )

    instance.get<{ Querystring: { stateId: string } }>(
      '/api/v1/drivers',
      async (request: AuthenticatedRequest, reply) => {
        const q = request.query as { stateId?: string }
        const h = request.headers['x-state-id']
        const stateIdRaw = q?.stateId ?? (Array.isArray(h) ? h[0] : h)
        const stateId = typeof stateIdRaw === 'string' ? stateIdRaw : null
        if (!stateId) return reply.code(400).send({ error: 'stateId required' })
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== stateId) {
          return reply.code(403).send({ error: 'State not in scope' })
        }
        const activeOnly = (request.query as { activeOnly?: string }).activeOnly !== 'false'
        const drivers = await driversRepo.listDriversByState(stateId, activeOnly)
        return reply.send(drivers)
      }
    )

    instance.get<{ Params: { id: string } }>(
      '/api/v1/drivers/:id',
      async (request: AuthenticatedRequest, reply) => {
        const params = request.params as { id: string }
        const driver = await driversRepo.findDriverById(params.id)
        if (!driver) return reply.code(404).send({ error: 'Driver not found' })
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== driver.stateId) {
          return reply.code(403).send({ error: 'State not in scope' })
        }
        const zips = await driversRepo.getDriverZips(driver.id)
        return reply.send({ ...driver, zips })
      }
    )

    instance.get<{ Querystring: { zips: string } }>(
      '/api/v1/zip-centroids',
      async (request: AuthenticatedRequest, reply) => {
        const zipsRaw = (request.query as { zips?: string }).zips
        const zips = [...new Set((zipsRaw ? zipsRaw.split(',').map((z) => z.trim()).filter(Boolean) : []) as string[])]
        if (zips.length === 0) return reply.send([])
        const docs = await ZipCentroid.find({ zip: { $in: zips } }).select('zip lat lon').lean()
        const found = new Set((docs as any[]).map((d) => d.zip))
        const missing = zips.filter((z) => !found.has(z))
        for (const zip of missing) {
          try {
            const res = await fetch(`https://api.zippopotam.us/us/${zip}`)
            if (!res.ok) continue
            const data = (await res.json()) as { places?: Array<{ latitude?: string; longitude?: string }> }
            const place = data?.places?.[0]
            const lat = place?.latitude != null ? parseFloat(place.latitude) : undefined
            const lon = place?.longitude != null ? parseFloat(place.longitude) : undefined
            if (lat != null && lon != null) {
              await ZipCentroid.findOneAndUpdate(
                { zip },
                { zip, lat, lon },
                { upsert: true, new: true }
              )
              ;(docs as any[]).push({ zip, lat, lon })
            }
          } catch {
            // skip
          }
          await new Promise((r) => setTimeout(r, 200))
        }
        return reply.send((docs as any[]).map((d: any) => ({ zip: d.zip, lat: d.lat, lon: d.lon })))
      }
    )
  })
}
