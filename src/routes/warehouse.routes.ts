import { FastifyInstance } from 'fastify'
import { authMiddleware, requireRole, requireStateScope, type AuthenticatedRequest } from '../middleware/auth'
import { Route } from '../models/Route'
import { RouteStop } from '../models/RouteStop'
import { Order } from '../models/Order'
import mongoose from 'mongoose'

export async function registerWarehouseRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (instance) => {
    instance.addHook('preHandler', authMiddleware)
    instance.addHook('preHandler', requireRole('warehouse', 'admin', 'manager', 'dispatcher'))

    instance.get<{ Querystring: { warehouseId?: string; stateId?: string } }>(
      '/api/v1/warehouse/jobs',
      async (request: AuthenticatedRequest, reply) => {
        const warehouseId = request.warehouseId || (request.query as { warehouseId?: string }).warehouseId
        const stateId =
          (request.query as { stateId?: string }).stateId ||
          request.headers['x-state-id'] ||
          request.stateId
        if (request.role === 'warehouse' && !warehouseId) {
          return reply.code(400).send({ error: 'warehouseId required for warehouse role' })
        }
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope && stateId && scope !== stateId) {
          return reply.code(403).send({ error: 'State not in scope' })
        }
        const match: any = {}
        if (stateId) match.stateId = new mongoose.Types.ObjectId(String(stateId))
        const routes = await Route.find(match).sort({ createdAt: -1 }).lean()
        const routeIds = routes.map((r) => r._id)
        const stops = await RouteStop.find({ routeId: { $in: routeIds } })
          .sort({ routeId: 1, sequence: 1 })
          .lean()
        const orderIds = [...new Set(stops.map((s) => String(s.orderId)))]
        const orders = await Order.find({ _id: { $in: orderIds } }).lean()
        const orderMap = new Map(orders.map((o) => [String(o._id), o]))
        let filteredRouteIds = routeIds
        if (warehouseId) {
          const ordersWithWarehouse = orders.filter(
            (o) => o.warehouseId && String(o.warehouseId) === warehouseId
          )
          const orderIdSet = new Set(ordersWithWarehouse.map((o) => String(o._id)))
          const routeIdsWithWarehouse = new Set(
            stops.filter((s) => orderIdSet.has(String(s.orderId))).map((s) => String(s.routeId))
          )
          filteredRouteIds = routeIds.filter((id) => routeIdsWithWarehouse.has(String(id)))
        }
        const byRoute = new Map<
          string,
          {
            routeId: string
            routeStatus: string
            assignedDriverId: string | null
            availableAt: string | null
            assignedAt: string | null
            startedAt: string | null
            completedAt: string | null
            stops: unknown[]
          }
        >()
        for (const r of routes) {
          if (!filteredRouteIds.some((id) => String(id) === String(r._id))) continue
          byRoute.set(String(r._id), {
            routeId: String(r._id),
            routeStatus: r.status,
            assignedDriverId: r.assignedDriverId ? String(r.assignedDriverId) : null,
            availableAt: r.availableAt ? String(r.availableAt) : null,
            assignedAt: r.assignedAt ? String(r.assignedAt) : null,
            startedAt: r.startedAt ? String(r.startedAt) : null,
            completedAt: r.completedAt ? String(r.completedAt) : null,
            stops: [],
          })
        }
        for (const s of stops) {
          const route = byRoute.get(String(s.routeId))
          if (!route) continue
          const o = orderMap.get(String(s.orderId))
          route.stops.push({
            stopId: String(s._id),
            sequence: s.sequence,
            addressLine1: s.addressLine1,
            addressCity: s.addressCity,
            addressState: s.addressState,
            addressZip: s.addressZip,
            stopStatus: s.status,
            completedAt: s.completedAt ? String(s.completedAt) : null,
            podS3Key: s.podS3Key,
            orderId: String(s.orderId),
            externalOrderId: o?.externalOrderId,
            externalShipmentId: o?.externalShipmentId,
          })
        }
        return reply.send(Array.from(byRoute.values()))
      }
    )
  })
}
