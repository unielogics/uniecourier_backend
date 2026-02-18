import { FastifyInstance } from 'fastify'
import { authMiddleware, requireRole, requireStateScope, type AuthenticatedRequest } from '../middleware/auth'
import { buildRoutesForState, buildRoutesAllStates } from '../services/route-builder.service'
import { flagExpiredAvailableRoutes, getExpirationAlertsForState } from '../services/route-expiration.service'

export async function registerJobsRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body?: { stateId?: string } }>(
    '/api/v1/jobs/route-builder',
    { preHandler: [authMiddleware, requireRole('admin', 'manager', 'dispatcher')] },
    async (request: AuthenticatedRequest, reply) => {
      const h = request.headers['x-state-id']
      const stateIdRaw = (request.body as { stateId?: string })?.stateId ?? (Array.isArray(h) ? h[0] : h)
      const stateId = typeof stateIdRaw === 'string' ? stateIdRaw : undefined
      const scope = requireStateScope(request)
      if (stateId) {
        if (request.role !== 'admin' && scope !== stateId) {
          return reply.code(403).send({ error: 'State not in scope' })
        }
        const result = await buildRoutesForState(stateId)
        return reply.send(result)
      }
      if (request.role !== 'admin') {
        return reply.code(403).send({ error: 'Admin only for all-states build' })
      }
      const results = await buildRoutesAllStates()
      return reply.send({ results })
    }
  )

  app.post(
    '/api/v1/jobs/route-expiration',
    { preHandler: [authMiddleware, requireRole('admin', 'manager', 'dispatcher')] },
    async (_, reply) => {
      const count = await flagExpiredAvailableRoutes()
      return reply.send({ flagged: count })
    }
  )

  app.get<{ Querystring: { stateId: string } }>(
    '/api/v1/alerts/expiration',
    { preHandler: [authMiddleware, requireRole('admin', 'manager', 'dispatcher')] },
    async (request: AuthenticatedRequest, reply) => {
      const q = request.query as { stateId?: string }
      const h = request.headers['x-state-id']
      const stateIdRaw = q?.stateId ?? (Array.isArray(h) ? h[0] : h)
      const stateId = typeof stateIdRaw === 'string' ? stateIdRaw : null
      if (!stateId) return reply.code(400).send({ error: 'stateId required' })
      const scope = requireStateScope(request)
      if (request.role !== 'admin' && scope !== stateId) {
        return reply.code(403).send({ error: 'State not in scope' })
      }
      const alerts = await getExpirationAlertsForState(stateId)
      return reply.send(alerts)
    }
  )
}
