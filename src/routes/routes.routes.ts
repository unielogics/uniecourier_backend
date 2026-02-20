import { FastifyInstance } from 'fastify'
import { authMiddleware, requireRole, requireStateScope, type AuthenticatedRequest } from '../middleware/auth'
import {
  listRoutesByState,
  getRouteById,
  getRouteStops,
  assignRoute,
  removeRouteStop,
} from '../repos/routes.repo'
import * as driversRepo from '../repos/drivers.repo'
import { getRatesByStateAndZips, getDefaultRateCents } from '../repos/zip_rate.repo'
import { Order } from '../models/Order'
import { Hub } from '../models/Hub'
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
        let stateIdRaw = q?.stateId ?? (Array.isArray(h) ? h[0] : h)
        const scope = requireStateScope(request)
        if (stateIdRaw === 'all') {
          if (request.role !== 'admin' && scope) stateIdRaw = scope
          else if (request.role !== 'admin') return reply.code(403).send({ error: 'All states requires admin role' })
        }
        const stateId = typeof stateIdRaw === 'string' ? stateIdRaw : null
        if (!stateId) return reply.code(400).send({ error: 'stateId required' })
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
        if (routes.length === 0) return reply.send(routes)
        const driverIds = [...new Set(routes.map((r) => r.assigned_driver_id).filter(Boolean))] as string[]
        const drivers = driverIds.length > 0 ? await Promise.all(driverIds.map((id) => driversRepo.findDriverById(id))) : []
        const driverMap = new Map(drivers.filter(Boolean).map((d) => [d!.id, d!.name]))
        const { RouteStop } = await import('../models/RouteStop')
        const stops = await RouteStop.find({ routeId: { $in: routes.map((r) => r.id) } }).lean()
        const orderIds = [...new Set(stops.map((s: any) => s.orderId))]
        const orders = orderIds.length > 0 ? await Order.find({ _id: { $in: orderIds } }).select('_id paymentStatus').lean() : []
        const orderPaymentMap = new Map(orders.map((o: any) => [String(o._id), o.paymentStatus === 'paid']))
        const routeUnpaidMap = new Map<string, boolean>()
        for (const s of stops as any[]) {
          const rid = String(s.routeId)
          const paid = orderPaymentMap.get(String(s.orderId)) ?? false
          if (!paid) routeUnpaidMap.set(rid, true)
        }
        const routesWithMeta = routes.map((r) => ({
          ...r,
          assignedDriverName: r.assigned_driver_id ? driverMap.get(r.assigned_driver_id) ?? null : null,
          allStopsPaid: stops.length === 0 ? true : !routeUnpaidMap.get(r.id),
        }))
        return reply.send(routesWithMeta)
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
        const orderIds = stops.map((s) => s.order_id)
        const orders = await Order.find({ _id: { $in: orderIds } }).lean()
        const orderMap = new Map(orders.map((o: any) => [String(o._id), o]))
        const zips = [...new Set(stops.map((s) => s.address_zip).filter(Boolean))]
        const zipRates = zips.length ? await getRatesByStateAndZips(route.state_id, zips) : new Map()
        const defaultRate = await getDefaultRateCents(route.state_id)
        const originHubIds = [...new Set(orders.map((o: any) => o.originHubId).filter(Boolean))]
        const hubs = await Hub.find({ _id: { $in: originHubIds } }).select('name addressLine1 addressCity addressState addressZip').lean()
        const hubMap = new Map(hubs.map((h: any) => [String(h._id), h]))
        let assignedDriver: { id: string; name: string; email: string | null; phone: string | null } | null = null
        if (route.assigned_driver_id) {
          const driver = await driversRepo.findDriverById(route.assigned_driver_id)
          if (driver) {
            assignedDriver = {
              id: driver.id,
              name: driver.name,
              email: driver.email ?? null,
              phone: driver.phone ?? null,
            }
          }
        }

        const stopsWithOrders = stops.map((s) => {
          const order = orderMap.get(s.order_id) as any
          if (!order) return { ...s, order: null, chargeCents: 0, payoutCents: 0, profitCents: 0, paymentStatus: 'unpaid' }
          const chargeCents = order.rateTotalCents ?? 0
          const payoutCents = zipRates.get(s.address_zip)?.driverPayoutCents ?? defaultRate.driverPayoutCents
          const profitCents = chargeCents - payoutCents
          const paymentStatus = order.paymentStatus === 'paid' ? 'paid' : 'unpaid'
          const originHub = order.originHubId ? hubMap.get(String(order.originHubId)) : null
          const orderData = {
            id: String(order._id),
            externalOrderId: order.externalOrderId,
            externalShipmentId: order.externalShipmentId,
            status: order.status,
            addressLine1: order.addressLine1,
            addressLine2: order.addressLine2,
            addressCity: order.addressCity,
            addressState: order.addressState,
            addressZip: order.addressZip,
            addressName: order.addressName,
            addressCompany: order.addressCompany,
            sku: order.sku,
            itemName: order.itemName,
            image: order.image,
            description: order.description,
            quantityUnits: order.quantityUnits,
            weightLbs: order.weightLbs,
            deadlineAt: order.deadlineAt,
            rateTotalCents: order.rateTotalCents,
            paymentStatus,
            originHub: originHub ? { id: String(originHub._id), name: (originHub as any).name, address: [(originHub as any).addressLine1, (originHub as any).addressCity, (originHub as any).addressState, (originHub as any).addressZip].filter(Boolean).join(', ') } : null,
          }
          return { ...s, order: orderData, chargeCents, payoutCents, profitCents, paymentStatus }
        })

        const allStopsPaid = stopsWithOrders.every((s) => s.paymentStatus === 'paid')

        return reply.send({
          ...route,
          assignedDriver,
          allStopsPaid,
          stops: stopsWithOrders,
        })
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

    instance.delete<{ Params: { id: string; stopId: string } }>(
      '/api/v1/routes/:id/stops/:stopId',
      async (request: AuthenticatedRequest, reply) => {
        if (request.role !== 'admin' && request.role !== 'manager') {
          return reply.code(403).send({ error: 'Admin or Manager only' })
        }
        const params = request.params as { id: string; stopId: string }
        const route = await getRouteById(params.id)
        if (!route) return reply.code(404).send({ error: 'Route not found' })
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== route.state_id) {
          return reply.code(403).send({ error: 'Route not in scope' })
        }
        const result = await removeRouteStop(params.stopId)
        if (!result.ok) return reply.code(400).send({ error: 'Stop not found or route completed' })
        if (result.routeId !== params.id) return reply.code(400).send({ error: 'Stop does not belong to this route' })
        return reply.send({ ok: true, orderId: result.orderId })
      }
    )

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
        let stateIdRaw = q?.stateId ?? (Array.isArray(h) ? h[0] : h)
        const scope = requireStateScope(request)
        if (stateIdRaw === 'all') {
          if (request.role !== 'admin' && scope) stateIdRaw = scope
          else if (request.role !== 'admin') return reply.code(403).send({ error: 'All states requires admin role' })
        }
        const stateId = typeof stateIdRaw === 'string' ? stateIdRaw : null
        if (!stateId) return reply.code(400).send({ error: 'stateId required' })
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

    instance.patch<{ Params: { id: string }; Body: { active?: boolean; onHold?: boolean } }>(
      '/api/v1/drivers/:id',
      async (request: AuthenticatedRequest, reply) => {
        const params = request.params as { id: string }
        const body = request.body as { active?: boolean; onHold?: boolean }
        const driver = await driversRepo.findDriverById(params.id)
        if (!driver) return reply.code(404).send({ error: 'Driver not found' })
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== driver.stateId) {
          return reply.code(403).send({ error: 'State not in scope' })
        }
        const update: { active?: boolean; onHold?: boolean } = {}
        if (typeof body.active === 'boolean') update.active = body.active
        if (typeof body.onHold === 'boolean') update.onHold = body.onHold
        if (Object.keys(update).length === 0) return reply.send({ ...driver })
        const ok = await driversRepo.updateDriverStatus(params.id, update)
        if (!ok) return reply.code(500).send({ error: 'Update failed' })
        const updated = await driversRepo.findDriverById(params.id)
        return reply.send(updated!)
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
