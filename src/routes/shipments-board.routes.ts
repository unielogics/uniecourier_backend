import { FastifyInstance } from 'fastify'
import { authMiddleware, requireRole, requireStateScope, type AuthenticatedRequest } from '../middleware/auth'
import { Order } from '../models/Order'
import { Hub } from '../models/Hub'
import { Route } from '../models/Route'
import { RouteStop } from '../models/RouteStop'
import { Driver } from '../models/Driver'

export async function registerShipmentsBoardRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (instance) => {
    instance.addHook('preHandler', authMiddleware)
    instance.addHook('preHandler', requireRole('admin', 'manager', 'dispatcher', 'warehouse'))

    instance.get<{ Querystring: { stateId?: string; status?: string; driverId?: string } }>(
      '/api/v1/shipments-board',
      async (request: AuthenticatedRequest, reply) => {
        const q = request.query as { stateId?: string; status?: string; driverId?: string }
        const stateId = q.stateId
        if (!stateId) return reply.code(400).send({ error: 'stateId required' })
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== stateId) {
          return reply.code(403).send({ error: 'State not in scope' })
        }
        const routeMatch: any = { stateId }
        if (q.driverId) routeMatch.assignedDriverId = q.driverId
        if (q.status) routeMatch.status = q.status
        const routes = await Route.find(routeMatch).sort({ createdAt: -1 }).lean()
        const routeIds = routes.map((r) => r._id)
        const stops = await RouteStop.find({ routeId: { $in: routeIds } })
          .sort({ routeId: 1, sequence: 1 })
          .lean()
        const orderIds = [...new Set(stops.map((s) => s.orderId))]
        const orders = await Order.find({ _id: { $in: orderIds } }).lean()
        const drivers = await Driver.find({ _id: { $in: routes.map((r) => r.assignedDriverId).filter(Boolean) } }).lean()
        const orderMap = new Map(orders.map((o) => [String(o._id), o]))
        const driverMap = new Map(drivers.map((d) => [String(d._id), d]))
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
            const order = orderMap.get(String(s.orderId))
            if (!order) continue
            const driver = r.assignedDriverId ? driverMap.get(String(r.assignedDriverId)) : null
            rows.push({
              orderId: String(order._id),
              externalOrderId: order.externalOrderId,
              externalShipmentId: order.externalShipmentId,
              status: order.status,
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
            })
          }
        }
        const pendingOrders = await Order.find({ stateId, status: { $in: ['pending', 'pending_pickup'] } }).lean()
        for (const o of pendingOrders) {
          rows.push({
            orderId: String(o._id),
            externalOrderId: o.externalOrderId,
            externalShipmentId: o.externalShipmentId,
            status: o.status,
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
