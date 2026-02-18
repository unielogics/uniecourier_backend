import { FastifyInstance } from 'fastify'
import { createOrder } from '../repos/orders.repo'
import { findStateByCode } from '../repos/states.repo'

const WMS_WEBHOOK_SECRET = process.env.WMS_WEBHOOK_SECRET || ''

export async function registerWmsIntegrationRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: {
      warehouseId?: string
      orderId?: string
      shipmentId?: string
      address: {
        line1: string
        city: string
        state: string
        zip: string
        name?: string
        company?: string
        line2?: string
        country?: string
      }
      deadlineAt?: string
    }
    Headers: { 'x-wms-webhook-secret'?: string }
  }>('/api/v1/wms/orders-ready', async (request, reply) => {
    if (WMS_WEBHOOK_SECRET && request.headers['x-wms-webhook-secret'] !== WMS_WEBHOOK_SECRET) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }
    const body = request.body as any
    if (!body?.address?.line1 || !body.address.city || !body.address.state || !body.address.zip) {
      return reply.code(400).send({ error: 'address.line1, city, state, zip required' })
    }
    const state = await findStateByCode(body.address.state)
    if (!state) {
      return reply.code(400).send({ error: `State not found: ${body.address.state}` })
    }
    const orderId = await createOrder({
      stateId: state.id,
      warehouseId: body.warehouseId,
      externalOrderId: body.orderId,
      externalShipmentId: body.shipmentId,
      addressLine1: body.address.line1,
      addressCity: body.address.city,
      addressState: body.address.state,
      addressZip: body.address.zip,
      addressName: body.address.name,
      addressCompany: body.address.company,
      addressLine2: body.address.line2,
      addressCountry: body.address.country,
      deadlineAt: body.deadlineAt ? new Date(body.deadlineAt) : undefined,
    })
    return reply.send({ orderId, stateId: state.id })
  })
}
