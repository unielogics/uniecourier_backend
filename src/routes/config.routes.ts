import { FastifyInstance } from 'fastify'
import { authMiddleware, requireRole, requireStateScope, type AuthenticatedRequest } from '../middleware/auth'
import { WeightSizeTier } from '../models/WeightSizeTier'
import { ItemTypeVehicleRule } from '../models/ItemTypeVehicleRule'

export async function registerConfigRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (instance) => {
    instance.addHook('preHandler', authMiddleware)
    instance.addHook('preHandler', requireRole('admin', 'manager'))

    // --- Weight/size tiers (same for all zones) ---
    instance.get<{ Querystring: { stateId: string } }>(
      '/api/v1/config/tiers',
      async (request: AuthenticatedRequest, reply) => {
        const stateId = (request.query as { stateId?: string }).stateId
        if (!stateId) return reply.code(400).send({ error: 'stateId required' })
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== stateId) return reply.code(403).send({ error: 'State not in scope' })
        const list = await WeightSizeTier.find({ stateId }).sort({ tier: 1 }).lean()
        return reply.send(list)
      }
    )

    instance.put<{ Body: { stateId: string; tier: number; label?: string; minWeightOz?: number; maxWeightOz?: number; minLengthIn?: number; maxLengthIn?: number; minWidthIn?: number; maxWidthIn?: number; minHeightIn?: number; maxHeightIn?: number } }>(
      '/api/v1/config/tiers',
      async (request: AuthenticatedRequest, reply) => {
        const body = request.body as any
        if (!body?.stateId || body?.tier == null) return reply.code(400).send({ error: 'stateId and tier required' })
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== body.stateId) return reply.code(403).send({ error: 'State not in scope' })
        const doc = await WeightSizeTier.findOneAndUpdate(
          { stateId: body.stateId, tier: Number(body.tier) },
          {
            label: body.label,
            minWeightOz: body.minWeightOz,
            maxWeightOz: body.maxWeightOz,
            minLengthIn: body.minLengthIn,
            maxLengthIn: body.maxLengthIn,
            minWidthIn: body.minWidthIn,
            maxWidthIn: body.maxWidthIn,
            minHeightIn: body.minHeightIn,
            maxHeightIn: body.maxHeightIn,
          },
          { upsert: true, new: true }
        ).lean()
        return reply.send(doc)
      }
    )

    // --- Item type → vehicle rules (parcel=car, freight/bulk/hazmat=van) ---
    instance.get<{ Querystring: { stateId: string } }>(
      '/api/v1/config/vehicle-rules',
      async (request: AuthenticatedRequest, reply) => {
        const stateId = (request.query as { stateId?: string }).stateId
        if (!stateId) return reply.code(400).send({ error: 'stateId required' })
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== stateId) return reply.code(403).send({ error: 'State not in scope' })
        const list = await ItemTypeVehicleRule.find({ stateId }).lean()
        return reply.send(list)
      }
    )

    instance.put<{ Body: { stateId: string; itemType: string; vehicleType: string } }>(
      '/api/v1/config/vehicle-rules',
      async (request: AuthenticatedRequest, reply) => {
        const body = request.body as any
        if (!body?.stateId || !body?.itemType || !body?.vehicleType) {
          return reply.code(400).send({ error: 'stateId, itemType, vehicleType required' })
        }
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== body.stateId) return reply.code(403).send({ error: 'State not in scope' })
        const doc = await ItemTypeVehicleRule.findOneAndUpdate(
          { stateId: body.stateId, itemType: body.itemType },
          { vehicleType: String(body.vehicleType) },
          { upsert: true, new: true }
        ).lean()
        return reply.send(doc)
      }
    )
  })
}
