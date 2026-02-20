import { FastifyInstance } from 'fastify'
import { authMiddleware, requireRole, requireStateScope, type AuthenticatedRequest } from '../middleware/auth'
import {
  getFinancialData,
  getWarehouseCodesForFilter,
  getIntermediariesForFilter,
  getDriverReportData,
} from '../repos/financial.repo'
import { listStates } from '../repos/states.repo'

export async function registerFinancialRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (instance) => {
    instance.addHook('preHandler', authMiddleware)
    instance.addHook('preHandler', requireRole('admin', 'manager', 'dispatcher', 'warehouse'))

    instance.get<{
      Querystring: {
        stateId?: string
        startDate?: string
        endDate?: string
        originWarehouseCode?: string
        intermediaryId?: string
        includeRows?: string
      }
    }>('/api/v1/financial', async (request: AuthenticatedRequest, reply) => {
      const q = request.query as {
        stateId?: string
        startDate?: string
        endDate?: string
        originWarehouseCode?: string
        intermediaryId?: string
        includeRows?: string
      }
      let stateId = q.stateId
      const scope = requireStateScope(request)
      if (stateId === 'all') {
        if (request.role === 'admin') {
          const stateRows = await listStates()
          stateId = stateRows.map((s) => s.id).join(',')
        } else if (scope) {
          stateId = scope
        } else {
          return reply.code(403).send({ error: 'All states requires admin role' })
        }
      } else if (!stateId && scope) {
        stateId = scope
      }
      if (!stateId) return reply.code(400).send({ error: 'stateId required' })
      if (request.role !== 'admin' && scope && scope !== stateId && !stateId.includes(scope)) {
        return reply.code(403).send({ error: 'State not in scope' })
      }
      const stateIds = stateId.includes(',') ? stateId.split(',') : [stateId]

      const now = new Date()
      const defaultEnd = new Date(now)
      defaultEnd.setHours(23, 59, 59, 999)
      const defaultStart = new Date(now)
      defaultStart.setDate(defaultStart.getDate() - 29)
      defaultStart.setHours(0, 0, 0, 0)

      const startDate = q.startDate ? new Date(q.startDate) : defaultStart
      const endDate = q.endDate ? new Date(q.endDate) : defaultEnd
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return reply.code(400).send({ error: 'Invalid startDate or endDate' })
      }
      if (startDate > endDate) {
        return reply.code(400).send({ error: 'startDate must be before endDate' })
      }

      const result = await getFinancialData({
        stateIds,
        startDate,
        endDate,
        originWarehouseCode: q.originWarehouseCode?.trim() || undefined,
        intermediaryId: q.intermediaryId?.trim() || undefined,
        includeRows: q.includeRows === 'true' || q.includeRows === '1',
      })
      return reply.send(result)
    })

    instance.get<{
      Querystring: { stateId?: string }
    }>('/api/v1/financial/warehouses', async (request: AuthenticatedRequest, reply) => {
      const q = request.query as { stateId?: string }
      let stateId = q.stateId
      const scope = requireStateScope(request)
      if (stateId === 'all' && request.role === 'admin') {
        const stateRows = await listStates()
        stateId = stateRows.map((s) => s.id).join(',')
      } else if (!stateId && scope) {
        stateId = scope
      } else if (stateId === 'all' && scope) {
        stateId = scope
      }
      if (!stateId) return reply.code(400).send({ error: 'stateId required' })
      const stateIds = stateId.includes(',') ? stateId.split(',') : [stateId]
      if (request.role !== 'admin' && scope && scope !== stateId && !stateIds.includes(scope)) {
        return reply.code(403).send({ error: 'State not in scope' })
      }
      const warehouses = await getWarehouseCodesForFilter(stateIds)
      return reply.send(warehouses)
    })

    instance.get<{
      Querystring: { stateId?: string; originWarehouseCode?: string }
    }>('/api/v1/financial/intermediaries', async (request: AuthenticatedRequest, reply) => {
      const q = request.query as { stateId?: string; originWarehouseCode?: string }
      let stateId = q.stateId
      const scope = requireStateScope(request)
      if (stateId === 'all' && request.role === 'admin') {
        const stateRows = await listStates()
        stateId = stateRows.map((s) => s.id).join(',')
      } else if (!stateId && scope) {
        stateId = scope
      } else if (stateId === 'all' && scope) {
        stateId = scope
      }
      if (!stateId) return reply.code(400).send({ error: 'stateId required' })
      const stateIds = stateId.includes(',') ? stateId.split(',') : [stateId]
      if (request.role !== 'admin' && scope && scope !== stateId && !stateIds.includes(scope)) {
        return reply.code(403).send({ error: 'State not in scope' })
      }
      const intermediaries = await getIntermediariesForFilter(
        stateIds,
        q.originWarehouseCode?.trim() || undefined
      )
      return reply.send(intermediaries)
    })

    instance.get<{
      Querystring: {
        stateId?: string
        startDate?: string
        endDate?: string
        driverId?: string
        includeRoutes?: string
      }
    }>('/api/v1/financial/driver-report', async (request: AuthenticatedRequest, reply) => {
      const q = request.query as {
        stateId?: string
        startDate?: string
        endDate?: string
        driverId?: string
        includeRoutes?: string
      }
      let stateId = q.stateId
      const scope = requireStateScope(request)
      if (stateId === 'all') {
        if (request.role === 'admin') {
          const stateRows = await listStates()
          stateId = stateRows.map((s) => s.id).join(',')
        } else if (scope) {
          stateId = scope
        } else {
          return reply.code(403).send({ error: 'All states requires admin role' })
        }
      } else if (!stateId && scope) {
        stateId = scope
      }
      if (!stateId) return reply.code(400).send({ error: 'stateId required' })
      const stateIds = stateId.includes(',') ? stateId.split(',') : [stateId]
      if (request.role !== 'admin' && scope && scope !== stateId && !stateIds.includes(scope)) {
        return reply.code(403).send({ error: 'State not in scope' })
      }
      const now = new Date()
      const defaultEnd = new Date(now)
      defaultEnd.setHours(23, 59, 59, 999)
      const defaultStart = new Date(now)
      defaultStart.setDate(defaultStart.getDate() - 29)
      defaultStart.setHours(0, 0, 0, 0)
      const startDate = q.startDate ? new Date(q.startDate) : defaultStart
      const endDate = q.endDate ? new Date(q.endDate) : defaultEnd
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return reply.code(400).send({ error: 'Invalid startDate or endDate' })
      }
      const result = await getDriverReportData({
        stateIds,
        startDate,
        endDate,
        driverId: q.driverId?.trim() || undefined,
        includeRoutes: q.includeRoutes === 'true' || q.includeRoutes === '1',
      })
      return reply.send(result)
    })
  })
}
