import { FastifyInstance } from 'fastify'
import { authMiddleware, requireRole, type AuthenticatedRequest } from '../middleware/auth'
import { Comment } from '../models/Comment'
import { User } from '../models/User'

export async function registerCommentsRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (instance) => {
    instance.addHook('preHandler', authMiddleware)
    instance.addHook('preHandler', requireRole('admin', 'manager', 'dispatcher', 'warehouse', 'driver'))

    instance.get<{ Querystring: { entityType: string; entityId: string } }>(
      '/api/v1/comments',
      async (request: AuthenticatedRequest, reply) => {
        const q = request.query as { entityType?: string; entityId?: string }
        if (!q.entityType || !q.entityId) {
          return reply.code(400).send({ error: 'entityType and entityId required' })
        }
        const comments = await Comment.find({ entityType: q.entityType, entityId: q.entityId })
          .sort({ createdAt: 1 })
          .lean()
        return reply.send(comments)
      }
    )

    instance.post<{ Body: { entityType: string; entityId: string; body: string } }>(
      '/api/v1/comments',
      async (request: AuthenticatedRequest, reply) => {
        const body = request.body as any
        if (!body?.entityType || !body?.entityId || !body?.body) {
          return reply.code(400).send({ error: 'entityType, entityId, body required' })
        }
        const user = await User.findById(request.userId).lean()
        const comment = await Comment.create({
          entityType: body.entityType,
          entityId: body.entityId,
          authorId: request.userId,
          authorName: user?.email || 'Unknown',
          body: body.body.trim(),
        })
        return reply.send(comment)
      }
    )
  })
}
