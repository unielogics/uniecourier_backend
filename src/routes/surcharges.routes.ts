import { FastifyInstance } from 'fastify'
import { authMiddleware, requireRole, requireStateScope, type AuthenticatedRequest } from '../middleware/auth'
import { ItemTypeSurcharge } from '../models/ItemTypeSurcharge'

export async function registerSurchargesRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (instance) => {
    instance.addHook('preHandler', authMiddleware)
    instance.addHook('preHandler', requireRole('admin', 'manager'))

    instance.get<{ Querystring: { stateId: string; zipCode?: string } }>(
      '/api/v1/surcharges',
      async (request: AuthenticatedRequest, reply) => {
        const stateId = (request.query as { stateId?: string }).stateId
        const zipCode = (request.query as { zipCode?: string }).zipCode
        if (!stateId) return reply.code(400).send({ error: 'stateId required' })
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== stateId) {
          return reply.code(403).send({ error: 'State not in scope' })
        }
        const filter: any = { stateId }
        if (zipCode != null && zipCode !== '') {
          filter.zipCode = zipCode
        } else if (zipCode === '') {
          // state-level default only
          filter.$or = [{ zipCode: '' }, { zipCode: null }, { zipCode: { $exists: false } }]
        }
        const list = await ItemTypeSurcharge.find(filter).sort({ zipCode: 1, itemType: 1 }).lean()
        return reply.send(list)
      }
    )

    instance.put<{ Body: { stateId: string; zipCode?: string; itemType: string; label: string; type: 'flat' | 'percent'; value: number } }>(
      '/api/v1/surcharges',
      async (request: AuthenticatedRequest, reply) => {
        const body = request.body as any
        if (!body?.stateId || !body?.itemType || body?.label == null) {
          return reply.code(400).send({ error: 'stateId, itemType, label required' })
        }
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== body.stateId) {
          return reply.code(403).send({ error: 'State not in scope' })
        }
        const zipCode = body.zipCode != null ? String(body.zipCode) : ''
        const type = body.type === 'percent' ? 'percent' : 'flat'
        const value = Number(body.value) ?? 0
        const costDollars = body.costDollars != null ? Number(body.costDollars) : undefined
        const filter: any = { stateId: body.stateId, itemType: body.itemType }
        if (zipCode === '') {
          filter.$or = [{ zipCode: '' }, { zipCode: { $exists: false } }, { zipCode: null }]
        } else {
          filter.zipCode = zipCode
        }
        const update: any = { label: body.label, type, value, active: true, zipCode: zipCode }
        if (costDollars !== undefined) update.costDollars = costDollars
        const doc = await ItemTypeSurcharge.findOneAndUpdate(
          filter,
          update,
          { upsert: true, new: true }
        ).lean()
        return reply.send(doc)
      }
    )

    instance.delete<{ Querystring: { stateId: string; zipCode?: string; itemType: string } }>(
      '/api/v1/surcharges',
      async (request: AuthenticatedRequest, reply) => {
        const q = request.query as { stateId?: string; zipCode?: string; itemType?: string }
        if (!q.stateId || !q.itemType) return reply.code(400).send({ error: 'stateId and itemType required' })
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== q.stateId) {
          return reply.code(403).send({ error: 'State not in scope' })
        }
        const zipCode = q.zipCode != null ? String(q.zipCode) : ''
        const filter: any = { stateId: q.stateId, itemType: q.itemType }
        if (zipCode === '') {
          filter.$or = [{ zipCode: '' }, { zipCode: { $exists: false } }, { zipCode: null }]
        } else {
          filter.zipCode = zipCode
        }
        await ItemTypeSurcharge.deleteOne(filter)
        return reply.send({ ok: true })
      }
    )
  })
}
