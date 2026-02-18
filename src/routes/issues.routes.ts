import { FastifyInstance } from 'fastify'
import { authMiddleware, requireRole, requireStateScope, type AuthenticatedRequest } from '../middleware/auth'
import { IssueReport } from '../models/IssueReport'

const ISSUE_TYPES = ['delivery_failed', 'damage', 'delay', 'wrong_address', 'other']

export async function registerIssuesRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (instance) => {
    instance.addHook('preHandler', authMiddleware)
    instance.addHook('preHandler', requireRole('admin', 'manager', 'dispatcher', 'warehouse', 'driver'))

    instance.get<{ Querystring: { entityType?: string; entityId?: string; stateId?: string; status?: string } }>(
      '/api/v1/issues',
      async (request: AuthenticatedRequest, reply) => {
        const q = request.query as any
        const filter: any = {}
        if (q.entityType) filter.entityType = q.entityType
        if (q.entityId) filter.entityId = q.entityId
        if (q.stateId) {
          const scope = requireStateScope(request)
          if (request.role !== 'admin' && scope !== q.stateId) {
            return reply.code(403).send({ error: 'State not in scope' })
          }
          filter.stateId = q.stateId
        }
        if (q.status) filter.status = q.status
        const list = await IssueReport.find(filter).sort({ createdAt: -1 }).lean()
        return reply.send(list)
      }
    )

    instance.post<{
      Body: { entityType: string; entityId: string; stateId?: string; type: string; summary: string; description?: string }
    }>('/api/v1/issues', async (request: AuthenticatedRequest, reply) => {
      const body = request.body as any
      if (!body?.entityType || !body?.entityId || !body?.type || !body?.summary) {
        return reply.code(400).send({ error: 'entityType, entityId, type, summary required' })
      }
      if (!ISSUE_TYPES.includes(body.type)) {
        return reply.code(400).send({ error: `type must be one of: ${ISSUE_TYPES.join(', ')}` })
      }
      const report = await IssueReport.create({
        entityType: body.entityType,
        entityId: body.entityId,
        stateId: body.stateId,
        type: body.type,
        summary: body.summary,
        description: body.description,
        reportedById: request.userId,
        status: 'open',
      })
      return reply.send(report)
    })

    instance.patch<{ Params: { id: string }; Body: { status: string } }>(
      '/api/v1/issues/:id',
      async (request: AuthenticatedRequest, reply) => {
        const params = request.params as { id: string }
        const body = request.body as { status?: string }
        const update: any = {}
        if (body?.status) update.status = body.status
        if (body?.status === 'resolved' || body?.status === 'closed') {
          update.resolvedAt = new Date()
          update.resolvedById = request.userId
        }
        const doc = await IssueReport.findByIdAndUpdate(params.id, update, { new: true }).lean()
        if (!doc) return reply.code(404).send({ error: 'Not found' })
        return reply.send(doc)
      }
    )
  })
}
