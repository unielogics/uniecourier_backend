import { FastifyInstance } from 'fastify'
import { authMiddleware, requireRole, requireStateScope, type AuthenticatedRequest } from '../middleware/auth'
import { WeightSizeTier } from '../models/WeightSizeTier'
import { ItemTypeVehicleRule } from '../models/ItemTypeVehicleRule'
import { VehicleMinCost } from '../models/VehicleMinCost'

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

    instance.put<{ Body: { stateId: string; tier: number; label?: string; minWeightLbs?: number; maxWeightLbs?: number; minLengthIn?: number; maxLengthIn?: number; minWidthIn?: number; maxWidthIn?: number; minHeightIn?: number; maxHeightIn?: number; plusCents?: number } }>(
      '/api/v1/config/tiers',
      async (request: AuthenticatedRequest, reply) => {
        const body = request.body as any
        if (!body?.stateId || body?.tier == null) return reply.code(400).send({ error: 'stateId and tier required' })
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== body.stateId) return reply.code(403).send({ error: 'State not in scope' })
        const minLbs = body.minWeightLbs != null && body.minWeightLbs !== '' ? Number(body.minWeightLbs) : 0
        const maxLbs = body.maxWeightLbs != null && body.maxWeightLbs !== '' ? Number(body.maxWeightLbs) : undefined
        const doc = await WeightSizeTier.findOneAndUpdate(
          { stateId: body.stateId, tier: Number(body.tier) },
          {
            label: body.label,
            minWeightLbs: Number.isFinite(minLbs) ? minLbs : 0,
            maxWeightLbs: maxLbs != null && Number.isFinite(maxLbs) ? maxLbs : undefined,
            minLengthIn: body.minLengthIn,
            maxLengthIn: body.maxLengthIn,
            minWidthIn: body.minWidthIn,
            maxWidthIn: body.maxWidthIn,
            minHeightIn: body.minHeightIn,
            maxHeightIn: body.maxHeightIn,
            plusCents: body.plusCents != null ? Number(body.plusCents) : undefined,
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

    // --- Minimum cost per vehicle type (e.g. car $70, truck $150) ---
    instance.get<{ Querystring: { stateId: string } }>(
      '/api/v1/config/vehicle-minimums',
      async (request: AuthenticatedRequest, reply) => {
        const stateId = (request.query as { stateId?: string }).stateId
        if (!stateId) return reply.code(400).send({ error: 'stateId required' })
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== stateId) return reply.code(403).send({ error: 'State not in scope' })
        const list = await VehicleMinCost.find({ stateId }).lean()
        return reply.send(list)
      }
    )

    instance.put<{ Body: { stateId: string; vehicleType: string; minCostCents: number } }>(
      '/api/v1/config/vehicle-minimums',
      async (request: AuthenticatedRequest, reply) => {
        const body = request.body as any
        if (!body?.stateId || !body?.vehicleType || body?.minCostCents == null) {
          return reply.code(400).send({ error: 'stateId, vehicleType, minCostCents required' })
        }
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== body.stateId) return reply.code(403).send({ error: 'State not in scope' })
        const minCostCents = Number(body.minCostCents)
        if (!Number.isFinite(minCostCents) || minCostCents < 0) return reply.code(400).send({ error: 'minCostCents must be a non-negative number' })
        const doc = await VehicleMinCost.findOneAndUpdate(
          { stateId: body.stateId, vehicleType: String(body.vehicleType) },
          { minCostCents },
          { upsert: true, new: true }
        ).lean()
        return reply.send(doc)
      }
    )
  })
}
