import { FastifyInstance } from 'fastify'
import { authMiddleware, requireRole, requireStateScope, type AuthenticatedRequest } from '../middleware/auth'
import { Order } from '../models/Order'
import { Hub } from '../models/Hub'
import { Route } from '../models/Route'
import { RouteStop } from '../models/RouteStop'
import { Driver } from '../models/Driver'
import { listStates } from '../repos/states.repo'
import { getRatesByStateAndZips, getDefaultRateCents } from '../repos/zip_rate.repo'

export async function registerShipmentsBoardRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (instance) => {
    instance.addHook('preHandler', authMiddleware)
    instance.addHook('preHandler', requireRole('admin', 'manager', 'dispatcher', 'warehouse'))

    instance.get<{ Querystring: { stateId?: string; status?: string; driverId?: string } }>(
      '/api/v1/shipments-board',
      async (request: AuthenticatedRequest, reply) => {
        const q = request.query as { stateId?: string; status?: string; driverId?: string }
        let stateId = q.stateId
        if (!stateId) return reply.code(400).send({ error: 'stateId required' })
        const scope = requireStateScope(request)
        if (stateId === 'all') {
          if (request.role === 'admin') {
            const stateRows = await listStates()
            stateId = stateRows.map((s) => s.id).join(',')
          } else if (scope) {
            stateId = scope
          } else {
            return reply.code(403).send({ error: 'All states requires admin role' })
          }
        } else if (request.role !== 'admin' && scope !== stateId) {
          return reply.code(403).send({ error: 'State not in scope' })
        }
        const stateIds = stateId.includes(',') ? stateId.split(',') : [stateId]
        const routeMatch: any = stateIds.length === 1 ? { stateId: stateIds[0] } : { stateId: { $in: stateIds } }
        if (q.driverId) routeMatch.assignedDriverId = q.driverId
        if (q.status) routeMatch.status = q.status
        const routes = await Route.find(routeMatch).sort({ createdAt: -1 }).lean()
        const routeIds = routes.map((r) => r._id)
        const stops = await RouteStop.find({ routeId: { $in: routeIds } })
          .sort({ routeId: 1, sequence: 1 })
          .lean()
        const orderIds = [...new Set(stops.map((s) => s.orderId))]
        const pendingMatch = stateIds.length === 1
          ? { stateId: stateIds[0], status: { $in: ['pending', 'pending_pickup'] } }
          : { stateId: { $in: stateIds }, status: { $in: ['pending', 'pending_pickup'] } }
        const [orders, pendingOrders, drivers] = await Promise.all([
          Order.find({ _id: { $in: orderIds } }).lean(),
          Order.find(pendingMatch).lean(),
          Driver.find({ _id: { $in: routes.map((r) => r.assignedDriverId).filter(Boolean) } }).lean(),
        ])
        const orderMap = new Map(orders.map((o) => [String(o._id), o]))
        const driverMap = new Map(drivers.map((d) => [String(d._id), d]))
        const allZips = [...new Set([...(orders as any[]), ...(pendingOrders as any[])].map((o: any) => o.addressZip).filter(Boolean))]
        const primaryStateId = stateIds[0]
        const zipRates = allZips.length ? await getRatesByStateAndZips(primaryStateId, allZips) : new Map()
        const defaultRate = await getDefaultRateCents(primaryStateId)
        const stopsByRoute = new Map<string, typeof stops>()
        for (const s of stops) {
          const rid = String(s.routeId)
          if (!stopsByRoute.has(rid)) stopsByRoute.set(rid, [])
          stopsByRoute.get(rid)!.push(s)
        }
        const rows: any[] = []
        for (const r of routes) {
          const routeStops = stopsByRoute.get(String(r._id)) || []
          for (const s of routeStops) {
            const order = orderMap.get(String(s.orderId)) as any
            if (!order) continue
            const driver = r.assignedDriverId ? driverMap.get(String(r.assignedDriverId)) : null
            const chargeCents = order.rateTotalCents ?? 0
            const payoutCents = zipRates.get(order.addressZip)?.driverPayoutCents ?? defaultRate.driverPayoutCents
            const profitCents = chargeCents - payoutCents
            rows.push({
              orderId: String(order._id),
              externalOrderId: order.externalOrderId,
              externalShipmentId: order.externalShipmentId,
              status: order.status,
              deadlineAt: (order as any).deadlineAt ?? null,
              addressLine1: order.addressLine1,
              addressCity: order.addressCity,
              addressState: order.addressState,
              addressZip: order.addressZip,
              originHubId: order.originHubId ? String(order.originHubId) : null,
              sku: order.sku ?? null,
              itemName: order.itemName ?? null,
              image: order.image ?? null,
              description: order.description ?? null,
              quantityUnits: order.quantityUnits ?? null,
              routeId: String(r._id),
              routeStatus: r.status,
              stopSequence: s.sequence,
              stopStatus: s.status,
              driverId: r.assignedDriverId ? String(r.assignedDriverId) : null,
              driverName: driver?.name ?? null,
              assignedAt: r.assignedAt,
              completedAt: s.completedAt,
              chargeCents,
              payoutCents,
              profitCents,
            })
          }
        }
        for (const o of pendingOrders) {
          const ord = o as any
          const chargeCents = ord.rateTotalCents ?? 0
          const payoutCents = zipRates.get(ord.addressZip)?.driverPayoutCents ?? defaultRate.driverPayoutCents
          const profitCents = chargeCents - payoutCents
          rows.push({
            orderId: String(o._id),
            externalOrderId: o.externalOrderId,
            externalShipmentId: o.externalShipmentId,
            status: o.status,
            deadlineAt: (o as any).deadlineAt ?? null,
            addressLine1: o.addressLine1,
            addressCity: o.addressCity,
            addressState: o.addressState,
            addressZip: o.addressZip,
            originHubId: o.originHubId ? String(o.originHubId) : null,
            sku: o.sku ?? null,
            itemName: o.itemName ?? null,
            image: o.image ?? null,
            description: o.description ?? null,
            quantityUnits: o.quantityUnits ?? null,
            routeId: null,
            routeStatus: null,
            stopSequence: null,
            stopStatus: null,
            driverId: null,
            driverName: null,
            assignedAt: null,
            completedAt: null,
            chargeCents,
            payoutCents,
            profitCents,
          })
        }
        const allOrders = [...orders, ...pendingOrders]
        const originHubIds = [...new Set(allOrders.map((o: any) => o.originHubId).filter(Boolean))]
        const hubMap = new Map<string, string>()
        if (originHubIds.length > 0) {
          const hubs = await Hub.find({ _id: { $in: originHubIds } }).select('name').lean()
          for (const h of hubs) hubMap.set(String((h as any)._id), (h as any).name)
        }
        for (const row of rows) {
          row.originHubName = row.originHubId ? hubMap.get(row.originHubId) ?? null : null
        }
        return reply.send(rows)
      }
    )
  })
}
