import { FastifyInstance } from 'fastify'
import { createOrder } from '../repos/orders.repo'
import { findStateByCode } from '../repos/states.repo'
import { Hub } from '../models/Hub'
import { Order } from '../models/Order'
import { calculateRate } from '../services/rate-shop.service'

const WMS_WEBHOOK_SECRET = process.env.WMS_WEBHOOK_SECRET || ''

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * WMS → UnieCourier API: create order/shipment with full item, address, ship-from, and bill-to.
 *
 * Request body:
 * - address: shipping address (line1, line2, city, state, zip, name, company, country)
 * - weightLbs, lengthIn, widthIn, heightIn (weight and dimensions)
 * - itemType: default "parcel" (kiosk always parcel)
 * - Item: sku, itemTitle, image, description, quantityUnits
 * - shipFrom: { originHubId } or { warehouseCode } — warehouse location mapped to shipment origin
 * - billTo: intermediary details → billing (name, company, email, phone)
 * - orderId?, shipmentId?, warehouseId?, deadlineAt?
 */
export async function registerWmsIntegrationRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: {
      warehouseId?: string
      orderId?: string
      shipmentId?: string
      /** Shipping address (destination) — all details */
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
      /** Weight in pounds (required for rate) */
      weightLbs: number
      /** Dimensions in inches (optional but used for rate) */
      lengthIn?: number
      widthIn?: number
      heightIn?: number
      /** Item type; kiosk sends parcel */
      itemType?: string
      /** Product / line item from WMS */
      sku?: string
      itemTitle?: string
      image?: string
      description?: string
      quantityUnits?: number
      /** Ship-from: warehouse location for mapping to origin hub */
      shipFrom?: {
        originHubId?: string
        warehouseCode?: string
      }
      /** Bill-to (intermediary details) — maps to billing on order */
      billTo: {
        name: string
        company?: string
        email?: string
        phone?: string
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
      return reply.code(400).send({ error: 'address.line1, address.city, address.state, address.zip required' })
    }
    if (body?.weightLbs == null) {
      return reply.code(400).send({ error: 'weightLbs required' })
    }
    if (!body?.billTo?.name?.trim()) {
      return reply.code(400).send({ error: 'billTo.name required (intermediary bill-to)' })
    }

    const state = await findStateByCode(body.address.state)
    if (!state) {
      return reply.code(400).send({ error: `State not found: ${body.address.state}` })
    }
    const stateId = state.id
    const zipCode = String(body.address.zip).trim().replace(/\D/g, '').slice(0, 5).padStart(5, '0')
    const itemType = (body.itemType || 'parcel').toLowerCase()
    if (!['parcel', 'freight', 'bulk', 'hazmat'].includes(itemType)) {
      return reply.code(400).send({ error: 'itemType must be parcel, freight, bulk, or hazmat' })
    }

    // Resolve origin hub (ship-from) for mapping to shipment
    let originHubId: string | undefined
    if (body.shipFrom?.originHubId?.trim()) {
      const hub = await Hub.findOne({
        _id: body.shipFrom.originHubId.trim(),
        stateId,
        active: true,
      }).lean()
      if (!hub) {
        return reply.code(400).send({ error: 'shipFrom.originHubId not found or not active in this state' })
      }
      originHubId = String((hub as any)._id)
    } else {
      // Default: first active hub in state (or could later map shipFrom.warehouseCode to a hub)
      const hub = await Hub.findOne({ stateId, active: true }).sort({ name: 1 }).select('_id').lean()
      if (hub) originHubId = String((hub as any)._id)
    }

    const rateResult = await calculateRate({
      stateId,
      zipCode,
      weightLbs: Number(body.weightLbs) || 0,
      lengthIn: body.lengthIn != null ? Number(body.lengthIn) : undefined,
      widthIn: body.widthIn != null ? Number(body.widthIn) : undefined,
      heightIn: body.heightIn != null ? Number(body.heightIn) : undefined,
      itemType,
    })
    if (rateResult.error && rateResult.error.includes('do not deliver')) {
      return reply.code(400).send({ error: rateResult.error })
    }
    const rateTotalCents = rateResult.totalCents ?? 0

    const orderId = await createOrder({
      stateId,
      originHubId,
      warehouseId: body.warehouseId,
      externalOrderId: body.orderId,
      externalShipmentId: body.shipmentId,
      addressLine1: String(body.address.line1).trim(),
      addressCity: String(body.address.city).trim(),
      addressState: String(body.address.state).trim(),
      addressZip: zipCode,
      addressName: body.address.name?.trim(),
      addressCompany: body.address.company?.trim(),
      addressLine2: body.address.line2?.trim(),
      addressCountry: body.address.country?.trim() || 'US',
      weightLbs: Number(body.weightLbs) || 0,
      lengthIn: body.lengthIn != null ? Number(body.lengthIn) : undefined,
      widthIn: body.widthIn != null ? Number(body.widthIn) : undefined,
      heightIn: body.heightIn != null ? Number(body.heightIn) : undefined,
      itemType,
      rateTotalCents,
      billingName: String(body.billTo.name).trim(),
      billingCompany: body.billTo.company?.trim(),
      billingEmail: body.billTo.email?.trim(),
      billingPhone: body.billTo.phone?.trim(),
      sku: body.sku?.trim(),
      itemName: (body.itemTitle ?? body.itemName)?.trim(),
      image: body.image?.trim(),
      description: body.description?.trim(),
      quantityUnits: body.quantityUnits != null ? Number(body.quantityUnits) : undefined,
      deadlineAt: body.deadlineAt ? new Date(body.deadlineAt) : undefined,
    })
    return reply.send({
      orderId,
      stateId,
      totalCents: rateTotalCents,
      totalDollars: rateResult.totalDollars ?? (rateTotalCents / 100).toFixed(2),
    })
  })

  /**
   * Get 4×6 shipping label HTML for a shipment (for WMS kiosk preview/print).
   * Auth: x-wms-webhook-secret must match WMS_WEBHOOK_SECRET.
   */
  app.get<{ Params: { id: string } }>(
    '/api/v1/wms/shipments/:id/label',
    async (request, reply) => {
      const secret = (request.headers['x-wms-webhook-secret'] as string) || ''
      if (WMS_WEBHOOK_SECRET && secret !== WMS_WEBHOOK_SECRET) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }
      const id = (request.params as { id: string }).id
      const doc = await Order.findById(id).lean()
      if (!doc) return reply.code(404).send({ error: 'Shipment not found' })
      let fromBlock = ''
      if (doc.originHubId) {
        const hub = await Hub.findById(doc.originHubId).select('name addressLine1 addressLine2 addressCity addressState addressZip').lean()
        if (hub) {
          const h = hub as any
          const fromAddr = [h.addressLine1, h.addressLine2, [h.addressCity, h.addressState].filter(Boolean).join(', '), h.addressZip].filter(Boolean).join('\n')
          fromBlock = `<div class="from" style="margin-bottom: 10px;"><div class="to">FROM:</div><div class="addr">${escapeHtml(h.name)}</div><div class="addr">${escapeHtml(fromAddr)}</div></div>`
        }
      }
      const toName = [doc.addressName, doc.addressCompany].filter(Boolean).join(' / ') || 'Recipient'
      const toAddr = [
        doc.addressLine1,
        doc.addressLine2,
        [doc.addressCity, doc.addressState].filter(Boolean).join(', '),
        doc.addressZip,
      ].filter(Boolean).join('\n')
      const orderShortId = String(doc._id).slice(-8).toUpperCase()
      let itemBlock = ''
      if (doc.itemName || doc.sku || doc.image || doc.description || doc.quantityUnits != null) {
        const parts: string[] = []
        if (doc.itemName) parts.push(escapeHtml(doc.itemName))
        if (doc.sku) parts.push(`SKU: ${escapeHtml(doc.sku)}`)
        if (doc.quantityUnits != null) parts.push(`Qty: ${doc.quantityUnits}`)
        if (doc.description) parts.push(escapeHtml(doc.description))
        const imgTag = doc.image ? `<img src="${escapeHtml(doc.image)}" alt="" style="max-width: 1.2in; max-height: 1in; object-fit: contain; margin-top: 4px;" />` : ''
        itemBlock = `<div class="tracking" style="margin-bottom: 8px;">${parts.join(' · ')}${imgTag ? `<br/>${imgTag}` : ''}</div>`
      }
      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Label ${orderShortId}</title>
<style>
  @page { size: 4in 6in; margin: 0.25in; }
  body { font-family: Arial, sans-serif; font-size: 12px; margin: 0; padding: 0.25in; box-sizing: border-box; width: 4in; min-height: 6in; }
  .to { font-weight: bold; margin-bottom: 4px; }
  .addr { white-space: pre-line; line-height: 1.3; }
  .tracking { margin-top: 12px; font-size: 10px; color: #666; }
  .id { font-family: monospace; font-size: 14px; letter-spacing: 1px; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head>
<body>
  ${fromBlock}
  ${itemBlock}
  <div class="to">TO:</div>
  <div class="addr">${escapeHtml(toName)}</div>
  <div class="addr">${escapeHtml(toAddr)}</div>
  <div class="tracking">Order ID: <span class="id">${escapeHtml(orderShortId)}</span></div>
  ${doc.weightLbs != null ? `<div class="tracking">Weight: ${escapeHtml(String(doc.weightLbs))} lbs</div>` : ''}
</body></html>`
      reply.header('Content-Type', 'text/html; charset=utf-8')
      return reply.send(html)
    }
  )
}
