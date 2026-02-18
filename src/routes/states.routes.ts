import { FastifyInstance } from 'fastify'
import { listStates, findStateById } from '../repos/states.repo'
import { authMiddleware, requireRole, requireStateScope, type AuthenticatedRequest } from '../middleware/auth'
import type { Role } from '../types'

export async function registerStateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/states', async (request, reply) => {
    const rows = await listStates()
    return reply.send(rows)
  })

  app.get<{ Params: { id: string } }>('/api/v1/states/:id', async (request, reply) => {
    const params = request.params as { id: string }
    const state = await findStateById(params.id)
    if (!state) return reply.code(404).send({ error: 'State not found' })
    return reply.send(state)
  })

  app.register(async (instance) => {
    instance.addHook('preHandler', authMiddleware)
    instance.addHook('preHandler', requireRole('admin', 'manager', 'dispatcher', 'warehouse'))

    instance.get('/api/v1/me/states', async (request: AuthenticatedRequest, reply) => {
      const scope = requireStateScope(request)
      if (request.role === 'admin') {
        const all = await listStates()
        return reply.send(all)
      }
      if (!scope) return reply.send([])
      const state = await findStateById(scope)
      return reply.send(state ? [state] : [])
    })
  })
}
