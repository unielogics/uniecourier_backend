import { FastifyInstance } from 'fastify'
import { authMiddleware, requireRole, requireStateScope, type AuthenticatedRequest } from '../middleware/auth'
import { ServiceAreaZip } from '../models/ServiceAreaZip'

export async function registerServiceAreasRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (instance) => {
    instance.addHook('preHandler', authMiddleware)
    instance.addHook('preHandler', requireRole('admin', 'manager'))

    instance.get<{ Querystring: { stateId: string } }>(
      '/api/v1/service-areas/zips',
      async (request: AuthenticatedRequest, reply) => {
        const stateId = (request.query as { stateId?: string }).stateId
        if (!stateId) return reply.code(400).send({ error: 'stateId required' })
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== stateId) {
          return reply.code(403).send({ error: 'State not in scope' })
        }
        const list = await ServiceAreaZip.find({ stateId }).sort({ zipCode: 1 }).lean()
        return reply.send(list)
      }
    )

    instance.post<{ Body: { stateId: string; zipCode: string; label?: string } }>(
      '/api/v1/service-areas/zips',
      async (request: AuthenticatedRequest, reply) => {
        const body = request.body as any
        if (!body?.stateId || !body?.zipCode?.trim()) {
          return reply.code(400).send({ error: 'stateId and zipCode required' })
        }
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== body.stateId) {
          return reply.code(403).send({ error: 'State not in scope' })
        }
        const zipCode = String(body.zipCode).trim()
        const existing = await ServiceAreaZip.findOne({ stateId: body.stateId, zipCode })
        if (existing) return reply.code(400).send({ error: 'Zip already in service area' })
        const doc = await ServiceAreaZip.create({
          stateId: body.stateId,
          zipCode,
          label: body.label?.trim() || undefined,
        })
        return reply.send(doc)
      }
    )

    instance.post<{ Body: { stateId: string; zips: string[] } }>(
      '/api/v1/service-areas/zips/bulk',
      async (request: AuthenticatedRequest, reply) => {
        const body = request.body as any
        if (!body?.stateId || !Array.isArray(body.zips)) {
          return reply.code(400).send({ error: 'stateId and zips (array) required' })
        }
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== body.stateId) {
          return reply.code(403).send({ error: 'State not in scope' })
        }
        const normalized = (body.zips as string[])
          .map((z) => String(z).trim().replace(/\D/g, '').slice(0, 5))
          .filter((z) => z.length >= 3)
          .map((z) => z.padStart(5, '0'))
        const unique = [...new Set(normalized)]
        const existing = await ServiceAreaZip.find({ stateId: body.stateId, zipCode: { $in: unique } }).distinct('zipCode').lean()
        const toAdd = unique.filter((z) => !existing.includes(z))
        if (toAdd.length === 0) {
          return reply.send({ added: 0, skipped: unique.length, message: 'All ZIPs already in service area' })
        }
        await ServiceAreaZip.insertMany(toAdd.map((zipCode) => ({ stateId: body.stateId, zipCode })))
        return reply.send({ added: toAdd.length, skipped: unique.length - toAdd.length, zips: toAdd })
      }
    )

    instance.delete<{ Querystring: { stateId: string; zipCode: string } }>(
      '/api/v1/service-areas/zips',
      async (request: AuthenticatedRequest, reply) => {
        const q = request.query as { stateId?: string; zipCode?: string }
        if (!q.stateId || !q.zipCode) return reply.code(400).send({ error: 'stateId and zipCode required' })
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== q.stateId) {
          return reply.code(403).send({ error: 'State not in scope' })
        }
        await ServiceAreaZip.deleteOne({ stateId: q.stateId, zipCode: q.zipCode })
        return reply.send({ ok: true })
      }
    )
  })
}
