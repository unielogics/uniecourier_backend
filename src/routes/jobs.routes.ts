import { FastifyInstance } from 'fastify'
import { authMiddleware, requireRole, requireStateScope, type AuthenticatedRequest } from '../middleware/auth'
import { buildRoutesForState, buildRoutesAllStates } from '../services/route-builder.service'
import { flagExpiredAvailableRoutes, getExpirationAlertsForState } from '../services/route-expiration.service'
import { flagDriverDocumentExpirations, getDriverDocumentExpirationAlertsForState } from '../services/driver-document-expiration.service'

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
    '/api/v1/jobs/driver-document-expiration',
    { preHandler: [authMiddleware, requireRole('admin', 'manager', 'dispatcher')] },
    async (_, reply) => {
      const count = await flagDriverDocumentExpirations()
      return reply.send({ flagged: count })
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
      let stateIdRaw = q?.stateId ?? (Array.isArray(h) ? h[0] : h)
      const scope = requireStateScope(request)
      if (stateIdRaw === 'all') {
        if (request.role !== 'admin' && scope) stateIdRaw = scope
        else if (request.role !== 'admin') return reply.code(403).send({ error: 'All states requires admin role' })
      }
      const stateId = typeof stateIdRaw === 'string' ? stateIdRaw : null
      if (!stateId) return reply.code(400).send({ error: 'stateId required' })
      if (request.role !== 'admin' && scope !== stateId) {
        return reply.code(403).send({ error: 'State not in scope' })
      }
      const alerts = await getExpirationAlertsForState(stateId)
      return reply.send(alerts)
    }
  )

  app.get<{ Querystring: { stateId: string; includeResolved?: string } }>(
    '/api/v1/alerts/driver-documents',
    { preHandler: [authMiddleware, requireRole('admin', 'manager', 'dispatcher')] },
    async (request: AuthenticatedRequest, reply) => {
      const q = request.query as { stateId?: string; includeResolved?: string }
      const h = request.headers['x-state-id']
      let stateIdRaw = q?.stateId ?? (Array.isArray(h) ? h[0] : h)
      const scope = requireStateScope(request)
      if (stateIdRaw === 'all') {
        if (request.role !== 'admin' && scope) stateIdRaw = scope
        else if (request.role !== 'admin') return reply.code(403).send({ error: 'All states requires admin role' })
      }
      const stateId = typeof stateIdRaw === 'string' ? stateIdRaw : null
      if (!stateId) return reply.code(400).send({ error: 'stateId required' })
      if (request.role !== 'admin' && scope !== stateId) {
        return reply.code(403).send({ error: 'State not in scope' })
      }
      const includeResolved = q?.includeResolved === 'true'
      const alerts = await getDriverDocumentExpirationAlertsForState(stateId, includeResolved)
      return reply.send(alerts)
    }
  )
}
