import mongoose from 'mongoose'
import { FastifyInstance } from 'fastify'
import { authMiddleware, requireRole, requireStateScope, type AuthenticatedRequest } from '../middleware/auth'
import { Order } from '../models/Order'
import { Hub } from '../models/Hub'
import { Warehouse } from '../models/Warehouse'
import { createOrder, updateOrderPaymentStatus } from '../repos/orders.repo'
import { resolveStateFromZip, calculateRate } from '../services/rate-shop.service'
import { getRatesByStateAndZips, getDefaultRateCents } from '../repos/zip_rate.repo'
import { ORDER_STATUSES } from '../models/Order'

export async function registerShipmentsRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (instance) => {
    instance.addHook('preHandler', authMiddleware)
    instance.addHook('preHandler', requireRole('admin', 'manager', 'dispatcher', 'warehouse'))

    // Get origin options (state + hubs) for a destination ZIP so user can pick origin hub
    instance.get<{ Querystring: { zip: string } }>(
      '/api/v1/shipments/origin-options',
      async (request: AuthenticatedRequest, reply) => {
        const zip = String((request.query as { zip?: string }).zip || '').replace(/\D/g, '').slice(0, 5)
        if (zip.length < 3) return reply.code(400).send({ error: 'Valid ZIP required' })
        const resolved = await resolveStateFromZip(zip)
        if ('noService' in resolved && resolved.noService) {
          return reply.code(400).send({ error: resolved.error ?? 'We do not deliver to this ZIP.' })
        }
        const stateId = (resolved as { stateId: string }).stateId
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== stateId) {
          return reply.code(403).send({ error: 'State not in scope' })
        }
        const hubs = await Hub.find({ stateId, active: true }).select('name addressLine1 addressCity addressState addressZip').sort({ name: 1 }).lean()
        return reply.send({
          stateId,
          stateCode: (resolved as { stateCode: string }).stateCode,
          stateName: (resolved as { stateName: string }).stateName,
          hubs: hubs.map((h: any) => ({ id: String(h._id), name: h.name, address: [h.addressLine1, h.addressCity, h.addressState, h.addressZip].filter(Boolean).join(', ') })),
        })
      }
    )

    // Create shipment manually: state derived from destination ZIP; origin hub and bill-to required
    instance.post<{
      Body: {
        originHubId: string
        addressLine1: string
        addressCity: string
        addressState: string
        addressZip: string
        addressName?: string
        addressCompany?: string
        addressLine2?: string
        weightLbs: number
        lengthIn?: number
        widthIn?: number
        heightIn?: number
        itemType?: string
        billingName: string
        billingCompany?: string
        billingEmail?: string
        billingPhone?: string
        sku?: string
        itemName?: string
        image?: string
        description?: string
        quantityUnits?: number
      }
    }>('/api/v1/shipments', async (request: AuthenticatedRequest, reply) => {
      const body = request.body as any
      if (!body?.addressLine1?.trim() || !body?.addressCity?.trim() || !body?.addressState?.trim() || !body?.addressZip?.trim() || body?.weightLbs == null) {
        return reply.code(400).send({ error: 'addressLine1, addressCity, addressState, addressZip, and weightLbs required' })
      }
      if (!body?.billingName?.trim()) {
        return reply.code(400).send({ error: 'Bill-to name (billingName) is required' })
      }
      if (!body?.originHubId?.trim()) {
        return reply.code(400).send({ error: 'Origin hub (originHubId) is required' })
      }
      const zipCode = String(body.addressZip).trim().replace(/\D/g, '').slice(0, 5)
      if (zipCode.length < 3) return reply.code(400).send({ error: 'Invalid addressZip' })

      // State is derived only from destination ZIP
      const resolved = await resolveStateFromZip(zipCode)
      if ('noService' in resolved && resolved.noService) {
        return reply.code(400).send({ error: resolved.error ?? 'We do not deliver to this ZIP/state.' })
      }
      const stateId = (resolved as { stateId: string }).stateId
      const scope = requireStateScope(request)
      if (request.role !== 'admin' && scope !== stateId) {
        return reply.code(403).send({ error: 'State not in scope' })
      }

      const originInput = String(body.originHubId).trim()
      let originHubId: string
      let warehouseId: string | undefined

      if (originInput.startsWith('warehouse:')) {
        const warehouseMongoId = originInput.slice('warehouse:'.length)
        const warehouse = await Warehouse.findOne({ _id: new mongoose.Types.ObjectId(warehouseMongoId), stateId }).lean()
        if (!warehouse) return reply.code(400).send({ error: 'Origin warehouse not found' })
        const firstHub = await Hub.findOne({ stateId, active: true }).sort({ name: 1 }).select('_id').lean()
        if (!firstHub) return reply.code(400).send({ error: 'No hub configured for this state; add a hub first' })
        originHubId = String((firstHub as any)._id)
        warehouseId = warehouseMongoId
      } else if (originInput.startsWith('primary:')) {
        const firstHub = await Hub.findOne({ stateId, active: true }).sort({ name: 1 }).select('_id').lean()
        if (!firstHub) return reply.code(400).send({ error: 'No hub configured for this state; add a hub first' })
        originHubId = String((firstHub as any)._id)
      } else {
        const hub = await Hub.findOne({ _id: originInput, stateId, active: true }).lean()
        if (!hub) return reply.code(400).send({ error: 'Origin hub not found or not in this state' })
        originHubId = originInput
      }

      const itemType = (body.itemType || 'parcel').toLowerCase()
      if (!['parcel', 'freight', 'bulk', 'hazmat'].includes(itemType)) {
        return reply.code(400).send({ error: 'itemType must be parcel, freight, bulk, or hazmat' })
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
      if (rateResult.noService || (rateResult.error && rateResult.error.includes('do not deliver'))) {
        return reply.code(400).send({ error: rateResult.error ?? 'Cannot create shipment for this destination.' })
      }

      const orderId = await createOrder({
        stateId,
        originHubId,
        warehouseId: warehouseId,
        addressLine1: String(body.addressLine1).trim(),
        addressCity: String(body.addressCity).trim(),
        addressState: String(body.addressState).trim(),
        addressZip: zipCode.padStart(5, '0'),
        addressName: body.addressName?.trim(),
        addressCompany: body.addressCompany?.trim(),
        addressLine2: body.addressLine2?.trim(),
        addressCountry: 'US',
        itemType,
        weightLbs: Number(body.weightLbs) || 0,
        lengthIn: body.lengthIn != null ? Number(body.lengthIn) : undefined,
        widthIn: body.widthIn != null ? Number(body.widthIn) : undefined,
        heightIn: body.heightIn != null ? Number(body.heightIn) : undefined,
        rateTotalCents: rateResult.totalCents,
        billingName: String(body.billingName).trim(),
        billingCompany: body.billingCompany?.trim(),
        billingEmail: body.billingEmail?.trim(),
        billingPhone: body.billingPhone?.trim(),
        status: 'pending_pickup',
        sku: body.sku?.trim() || undefined,
        itemName: body.itemName?.trim() || undefined,
        image: body.image?.trim() || undefined,
        description: body.description?.trim() || undefined,
        quantityUnits: body.quantityUnits != null ? Number(body.quantityUnits) : undefined,
      })
      return reply.send({
        orderId,
        totalDollars: rateResult.totalDollars,
        rateTotalCents: rateResult.totalCents,
        stateId,
        stateCode: rateResult.stateCode,
        stateName: rateResult.stateName,
      })
    })

    // Get single shipment/order
    instance.get<{ Params: { id: string } }>(
      '/api/v1/shipments/:id',
      async (request: AuthenticatedRequest, reply) => {
        const id = (request.params as { id: string }).id
        const doc = await Order.findById(id).lean()
        if (!doc) return reply.code(404).send({ error: 'Shipment not found' })
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== String(doc.stateId)) {
          return reply.code(403).send({ error: 'Shipment not in scope' })
        }
        let originHub: { id: string; name: string; address: string } | null = null
        if (doc.originHubId) {
          const h = await Hub.findById(doc.originHubId).select('name addressLine1 addressCity addressState addressZip').lean()
          if (h) {
            const ha = (h as any)
            originHub = {
              id: String(ha._id),
              name: ha.name,
              address: [ha.addressLine1, ha.addressCity, ha.addressState, ha.addressZip].filter(Boolean).join(', '),
            }
          }
        }
        const d = doc as any
        const chargeCents = d.rateTotalCents ?? 0
        const zipRates = d.addressZip ? await getRatesByStateAndZips(String(doc.stateId), [d.addressZip]) : new Map()
        const defaultRate = await getDefaultRateCents(String(doc.stateId))
        const payoutCents = zipRates.get(d.addressZip)?.driverPayoutCents ?? defaultRate.driverPayoutCents
        const profitCents = chargeCents - payoutCents
        return reply.send({
          id: String(doc._id),
          stateId: String(doc.stateId),
          originHubId: doc.originHubId ? String(doc.originHubId) : null,
          originHub: originHub ?? (d.originWarehouseName && d.originWarehouseAddress ? { id: d.originWarehouseCode || '', name: d.originWarehouseName, address: d.originWarehouseAddress } : null),
          originWarehouseCode: d.originWarehouseCode ?? null,
          originWarehouseName: d.originWarehouseName ?? null,
          originWarehouseAddress: d.originWarehouseAddress ?? null,
          intermediaryId: d.intermediaryId ?? null,
          intermediaryName: d.intermediaryName ?? null,
          warehouseId: doc.warehouseId ? String(doc.warehouseId) : null,
          externalOrderId: doc.externalOrderId ?? null,
          externalShipmentId: doc.externalShipmentId ?? null,
          status: doc.status,
          addressLine1: doc.addressLine1,
          addressLine2: doc.addressLine2,
          addressCity: doc.addressCity,
          addressState: doc.addressState,
          addressZip: doc.addressZip,
          addressCountry: doc.addressCountry ?? 'US',
          addressName: doc.addressName,
          addressCompany: doc.addressCompany,
          weightLbs: doc.weightLbs,
          lengthIn: doc.lengthIn,
          widthIn: doc.widthIn,
          heightIn: doc.heightIn,
          itemType: doc.itemType,
          rateTotalCents: doc.rateTotalCents,
          chargeCents,
          payoutCents,
          profitCents,
          billingName: doc.billingName,
          billingCompany: doc.billingCompany,
          billingEmail: doc.billingEmail,
          billingPhone: doc.billingPhone,
          sku: doc.sku ?? null,
          itemName: doc.itemName ?? null,
          image: doc.image ?? null,
          description: doc.description ?? null,
          quantityUnits: doc.quantityUnits ?? null,
          deadlineAt: doc.deadlineAt ?? null,
          paymentStatus: (doc as any).paymentStatus ?? 'unpaid',
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        })
      }
    )

    // 4×6 shipping label (HTML for print) — same template as Kiosk (UnieLogo, barcode, ship to/from, boxes/weight/size, track URL)
    instance.get<{ Params: { id: string } }>(
      '/api/v1/shipments/:id/label',
      async (request: AuthenticatedRequest, reply) => {
        const id = (request.params as { id: string }).id
        const doc = await Order.findById(id).lean()
        if (!doc) return reply.code(404).send({ error: 'Shipment not found' })
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== String(doc.stateId)) {
          return reply.code(403).send({ error: 'Shipment not in scope' })
        }
        const d = doc as any
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
        const trackingNumber = String(d._id)
        const weight = d.weightLbs != null && d.weightLbs > 0 ? `${d.weightLbs} lbs` : '—'
        const size =
          d.lengthIn != null && d.widthIn != null && d.heightIn != null
            ? `${d.lengthIn} × ${d.widthIn} × ${d.heightIn} in`
            : '—'
        const intermediaryName = d.intermediaryName ?? d.billingName ?? undefined
        const { generateUnieCourierLabelHtml } = await import('../services/label-template.service')
        const html = generateUnieCourierLabelHtml({
          trackingNumber,
          shipTo,
          shipFrom,
          boxes: 1,
          weight,
          size,
          intermediaryName,
        })
        reply.header('Content-Type', 'text/html; charset=utf-8')
        return reply.send(html)
      }
    )

    // Update shipment status
    instance.patch<{ Params: { id: string }; Body: { status: string } }>(
      '/api/v1/shipments/:id/status',
      async (request: AuthenticatedRequest, reply) => {
        const id = (request.params as { id: string }).id
        const body = request.body as any
        const status = body?.status ? String(body.status).trim() : ''
        if (!ORDER_STATUSES.includes(status as any)) {
          return reply.code(400).send({ error: `status must be one of: ${ORDER_STATUSES.join(', ')}` })
        }
        const doc = await Order.findById(id)
        if (!doc) return reply.code(404).send({ error: 'Shipment not found' })
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== String(doc.stateId)) {
          return reply.code(403).send({ error: 'Shipment not in scope' })
        }
        doc.status = status
        await doc.save()
        return reply.send({ id, status: doc.status })
      }
    )

    // Update shipment payment status (admin/manager only)
    instance.patch<{ Params: { id: string }; Body: { paymentStatus: string } }>(
      '/api/v1/shipments/:id/payment-status',
      async (request: AuthenticatedRequest, reply) => {
        const id = (request.params as { id: string }).id
        const body = request.body as any
        const paymentStatus = body?.paymentStatus ? String(body.paymentStatus).trim() : ''
        if (paymentStatus !== 'paid' && paymentStatus !== 'unpaid') {
          return reply.code(400).send({ error: 'paymentStatus must be "paid" or "unpaid"' })
        }
        if (request.role !== 'admin' && request.role !== 'manager') {
          return reply.code(403).send({ error: 'Admin or Manager only' })
        }
        const doc = await Order.findById(id).lean()
        if (!doc) return reply.code(404).send({ error: 'Shipment not found' })
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== String(doc.stateId)) {
          return reply.code(403).send({ error: 'Shipment not in scope' })
        }
        const ok = await updateOrderPaymentStatus(id, paymentStatus as 'paid' | 'unpaid')
        if (!ok) return reply.code(404).send({ error: 'Shipment not found' })
        return reply.send({ id, paymentStatus })
      }
    )
  })
}
