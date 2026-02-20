import { FastifyInstance } from 'fastify'
import { authMiddleware, requireRole, requireStateScope, type AuthenticatedRequest } from '../middleware/auth'
import { DeliveryDispute } from '../models/DeliveryDispute'
import { Order } from '../models/Order'
import { listStates } from '../repos/states.repo'

export async function registerDisputesRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (instance) => {
    instance.addHook('preHandler', authMiddleware)
    instance.addHook('preHandler', requireRole('admin', 'manager', 'dispatcher', 'warehouse'))

    instance.get<{
      Querystring: {
        stateId?: string
        status?: string
        originWarehouseCode?: string
        startDate?: string
        endDate?: string
      }
    }>('/api/v1/disputes', async (request: AuthenticatedRequest, reply) => {
      const q = request.query as {
        stateId?: string
        status?: string
        originWarehouseCode?: string
        startDate?: string
        endDate?: string
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
      if (request.role !== 'admin' && scope && stateIds.length > 1 && !stateIds.includes(scope)) {
        return reply.code(403).send({ error: 'State not in scope' })
      }

      const match: Record<string, unknown> = {
        stateId: stateIds.length === 1 ? stateIds[0] : { $in: stateIds },
      }
      if (q.status) match.status = q.status
      if (q.originWarehouseCode) match.originWarehouseCode = q.originWarehouseCode
      if (q.startDate || q.endDate) {
        match.createdAt = {}
        if (q.startDate) (match.createdAt as any).$gte = new Date(q.startDate)
        if (q.endDate) (match.createdAt as any).$lte = new Date(q.endDate)
      }

      const docs = await DeliveryDispute.find(match)
        .sort({ createdAt: -1 })
        .lean()
      const list = docs.map((d: any) => ({
        id: String(d._id),
        orderId: String(d.orderId),
        stateId: String(d.stateId),
        raisedBy: d.raisedBy,
        requestType: d.requestType,
        reasonCategory: d.reasonCategory,
        reason: d.reason,
        requestedAmountCents: d.requestedAmountCents,
        status: d.status,
        resolvedAmountCents: d.resolvedAmountCents,
        resolvedAt: d.resolvedAt,
        resolvedBy: d.resolvedBy,
        resolutionNotes: d.resolutionNotes,
        originWarehouseCode: d.originWarehouseCode,
        intermediaryId: d.intermediaryId,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      }))
      return reply.send(list)
    })

    instance.post<{
      Body: {
        orderId: string
        requestType: 'refund' | 'adjustment' | 'credit'
        reason: string
        reasonCategory?: string
        requestedAmountCents?: number
      }
    }>('/api/v1/disputes', async (request: AuthenticatedRequest, reply) => {
      const body = request.body as any
      const orderId = body?.orderId
      const requestType = body?.requestType
      const reason = body?.reason?.trim()
      if (!orderId || !requestType || !reason) {
        return reply.code(400).send({ error: 'orderId, requestType, and reason are required' })
      }
      if (!['refund', 'adjustment', 'credit'].includes(requestType)) {
        return reply.code(400).send({ error: 'requestType must be refund, adjustment, or credit' })
      }

      const order = await Order.findById(orderId).lean()
      if (!order) return reply.code(404).send({ error: 'Order not found' })
      const o = order as any

      const raisedBy = request.role === 'warehouse' ? 'warehouse' : 'admin'
      const doc = await DeliveryDispute.create({
        orderId,
        stateId: o.stateId,
        raisedBy,
        requestType,
        reasonCategory: body.reasonCategory || 'other',
        reason,
        requestedAmountCents: body.requestedAmountCents != null ? Number(body.requestedAmountCents) : undefined,
        status: 'open',
        originWarehouseCode: o.originWarehouseCode,
        intermediaryId: o.intermediaryId,
      })
      return reply.code(201).send({
        id: String(doc._id),
        orderId: String(doc.orderId),
        stateId: String(doc.stateId),
        raisedBy: doc.raisedBy,
        requestType: doc.requestType,
        reason: doc.reason,
        requestedAmountCents: doc.requestedAmountCents,
        status: doc.status,
        originWarehouseCode: doc.originWarehouseCode,
        intermediaryId: doc.intermediaryId,
        createdAt: doc.createdAt,
      })
    })

    instance.get<{ Params: { id: string } }>(
      '/api/v1/disputes/:id',
      async (request: AuthenticatedRequest, reply) => {
        const id = (request.params as { id: string }).id
        const doc = await DeliveryDispute.findById(id).lean()
        if (!doc) return reply.code(404).send({ error: 'Dispute not found' })
        const d = doc as any
        return reply.send({
          id: String(d._id),
          orderId: String(d.orderId),
          stateId: String(d.stateId),
          raisedBy: d.raisedBy,
          requestType: d.requestType,
          reasonCategory: d.reasonCategory,
          reason: d.reason,
          requestedAmountCents: d.requestedAmountCents,
          status: d.status,
          resolvedAmountCents: d.resolvedAmountCents,
          resolvedAt: d.resolvedAt,
          resolvedBy: d.resolvedBy,
          resolutionNotes: d.resolutionNotes,
          originWarehouseCode: d.originWarehouseCode,
          intermediaryId: d.intermediaryId,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        })
      }
    )

    instance.patch<{
      Params: { id: string }
      Body: { status: string; resolvedAmountCents?: number; resolutionNotes?: string }
    }>('/api/v1/disputes/:id', async (request: AuthenticatedRequest, reply) => {
      if (request.role !== 'admin' && request.role !== 'manager') {
        return reply.code(403).send({ error: 'Only admin or manager can resolve disputes' })
      }
      const id = (request.params as { id: string }).id
      const body = request.body as any
      const status = body?.status
      if (!status || !['approved', 'denied', 'adjusted'].includes(status)) {
        return reply.code(400).send({ error: 'status must be approved, denied, or adjusted' })
      }

      const doc = await DeliveryDispute.findById(id)
      if (!doc) return reply.code(404).send({ error: 'Dispute not found' })
      if (doc.status !== 'open') {
        return reply.code(400).send({ error: 'Dispute is already resolved' })
      }

      const update: any = {
        status,
        resolvedAt: new Date(),
        resolvedBy: request.userId || 'unknown',
      }
      if (body.resolutionNotes != null) update.resolutionNotes = String(body.resolutionNotes).trim()
      if (status === 'adjusted' && body.resolvedAmountCents != null) {
        update.resolvedAmountCents = Math.round(Number(body.resolvedAmountCents))
      } else if (status === 'approved' && body.resolvedAmountCents != null) {
        update.resolvedAmountCents = Math.round(Number(body.resolvedAmountCents))
      }

      await DeliveryDispute.findByIdAndUpdate(id, { $set: update })
      const updated = await DeliveryDispute.findById(id).lean()
      const d = updated as any
      return reply.send({
        id: String(d._id),
        orderId: String(d.orderId),
        stateId: String(d.stateId),
        raisedBy: d.raisedBy,
        requestType: d.requestType,
        reason: d.reason,
        requestedAmountCents: d.requestedAmountCents,
        status: d.status,
        resolvedAmountCents: d.resolvedAmountCents,
        resolvedAt: d.resolvedAt,
        resolvedBy: d.resolvedBy,
        resolutionNotes: d.resolutionNotes,
        updatedAt: d.updatedAt,
      })
    })
  })
}
