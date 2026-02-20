import { FastifyInstance } from 'fastify'
import { createOrder } from '../repos/orders.repo'
import { findStateByCode } from '../repos/states.repo'
import { Hub } from '../models/Hub'
import { Order } from '../models/Order'
import { Warehouse } from '../models/Warehouse'
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
      /** Ship-from: warehouse location for mapping to origin hub. Include warehouseCode + name + address for Origin Hub display. */
      shipFrom?: {
        originHubId?: string
        warehouseCode?: string
        name?: string
        addressLine1?: string
        addressLine2?: string
        city?: string
        state?: string
        zip?: string
      }
      /** Bill-to (intermediary details) — maps to billing on order */
      billTo: {
        name: string
        company?: string
        email?: string
        phone?: string
      }
      /** Intermediary ID (WMS) for billing reports and disputes */
      intermediaryId?: string
      /** Intermediary name for billing reports, disputes, and 4×6 label */
      intermediaryName?: string
      /** Agreed rate in cents (from Kiosk rate-shopping). When provided, used instead of recalculating. */
      rateTotalCents?: number
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
    } else if (body.shipFrom?.warehouseCode?.trim() || body.shipFrom?.state?.trim()) {
      // Map warehouseCode to origin hub: find warehouse by code in UnieCourier DB, then first active hub in that state.
      // If warehouse not in UnieCourier (e.g. WMS-only), use shipFrom.state (origin/warehouse state) to pick a hub.
      const warehouse = body.shipFrom?.warehouseCode?.trim()
        ? await Warehouse.findOne({ code: body.shipFrom.warehouseCode.trim() }).lean()
        : null
      let hubStateId: string | undefined
      if (warehouse) {
        hubStateId = String((warehouse as any).stateId)
      } else if (body.shipFrom?.state?.trim()) {
        const originState = await findStateByCode(body.shipFrom.state.trim())
        if (originState) hubStateId = originState.id
      }
      if (!hubStateId) hubStateId = stateId
      const hub = await Hub.findOne({ stateId: hubStateId, active: true }).sort({ name: 1 }).select('_id').lean()
      if (hub) originHubId = String((hub as any)._id)
    }
    if (!originHubId) {
      // Fallback: first active hub in destination state
      const hub = await Hub.findOne({ stateId, active: true }).sort({ name: 1 }).select('_id').lean()
      if (hub) originHubId = String((hub as any)._id)
    }

    const sf = body.shipFrom
    const originWarehouseCode = sf?.warehouseCode?.trim() || undefined
    const originWarehouseName = sf?.name?.trim() || undefined
    let originWarehouseAddress: string | undefined
    if (sf?.addressLine1 || sf?.city) {
      const parts: string[] = [sf.addressLine1?.trim(), sf.addressLine2?.trim()].filter(Boolean)
      const csz = [sf.city, sf.state, sf.zip].filter(Boolean).join(', ').trim()
      if (csz) parts.push(csz)
      originWarehouseAddress = parts.join('\n')
    }

    let rateTotalCents: number
    if (body.rateTotalCents != null && Number.isFinite(Number(body.rateTotalCents)) && Number(body.rateTotalCents) > 0) {
      rateTotalCents = Math.round(Number(body.rateTotalCents))
    } else {
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
      rateTotalCents = rateResult.totalCents ?? 0
    }

    const orderId = await createOrder({
      stateId,
      originHubId,
      originWarehouseCode,
      originWarehouseName,
      originWarehouseAddress,
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
      intermediaryId: body.intermediaryId?.trim() || undefined,
      intermediaryName: body.intermediaryName?.trim() || undefined,
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
      totalDollars: (rateTotalCents / 100).toFixed(2),
    })
  })

  /**
   * Get 4×6 shipping label HTML for a shipment (identical format to Kiosk).
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
      const d = doc as any

      const shipTo = [
        d.addressName,
        d.addressCompany,
        d.addressLine1,
        d.addressLine2,
        [d.addressCity, d.addressState, d.addressZip].filter(Boolean).join(', '),
        d.addressCountry,
      ]
        .filter(Boolean)
        .join('\n') || '—'

      let shipFrom = '—'
      if (d.originWarehouseName && d.originWarehouseAddress) {
        shipFrom = [d.originWarehouseName, d.originWarehouseAddress].filter(Boolean).join('\n')
      } else if (d.originHubId) {
        const hub = await Hub.findById(d.originHubId).select('name addressLine1 addressLine2 addressCity addressState addressZip').lean()
        if (hub) {
          const h = hub as any
          shipFrom = [
            h.name,
            h.addressLine1,
            h.addressLine2,
            [h.addressCity, h.addressState, h.addressZip].filter(Boolean).join(', '),
          ]
            .filter(Boolean)
            .join('\n')
        }
      }

      const trackingNumber = String(d._id)
      const weight = d.weightLbs != null && d.weightLbs > 0 ? `${d.weightLbs} lbs` : '—'
      const size =
        d.lengthIn != null && d.widthIn != null && d.heightIn != null
          ? `${d.lengthIn} × ${d.widthIn} × ${d.heightIn} in`
          : '—'

      const { generateUnieCourierLabelHtml } = await import('../services/label-template.service')
      const html = generateUnieCourierLabelHtml({
        trackingNumber,
        shipTo,
        shipFrom,
        boxes: 1,
        weight,
        size,
      })
      reply.header('Content-Type', 'text/html; charset=utf-8')
      return reply.send(html)
    }
  )
}
