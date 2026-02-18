import { FastifyInstance } from 'fastify'
import { authMiddleware, requireRole, requireStateScope, type AuthenticatedRequest } from '../middleware/auth'
import { Hub } from '../models/Hub'
import { Warehouse } from '../models/Warehouse'
import { State } from '../models/State'
import { PrimaryLocation } from '../models/PrimaryLocation'
import { getWarehousesFromUnieWmsDb, normalizeStateCodeForWarehouses, UNIEWMS_DB_NAME } from '../config/uniewms-connection'

const WMS_API_URL = process.env.WMS_API_URL || ''
const WMS_API_KEY = process.env.WMS_API_KEY || ''

export async function registerHubsRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (instance) => {
    instance.addHook('preHandler', authMiddleware)
    instance.addHook('preHandler', requireRole('admin', 'manager', 'dispatcher'))

    instance.get<{ Querystring: { stateId: string } }>(
      '/api/v1/warehouses',
      async (request: AuthenticatedRequest, reply) => {
        const stateId = (request.query as { stateId?: string }).stateId
        if (!stateId) return reply.code(400).send({ error: 'stateId required' })
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== stateId) {
          return reply.code(403).send({ error: 'State not in scope' })
        }
        const state = await State.findById(stateId).lean()
        const rawCode = state?.code ?? ''
        const stateCode = normalizeStateCodeForWarehouses(rawCode)
        request.log?.info?.({ stateId, rawCode, stateCode, stateFound: !!state }, 'Warehouses: state lookup')

        // 1) Try WMS API if configured
        if (WMS_API_URL && WMS_API_KEY) {
          try {
            const base = WMS_API_URL.replace(/\/$/, '')
            const url = stateCode ? `${base}/api/v1/courier/warehouses?state=${encodeURIComponent(stateCode)}` : `${base}/api/v1/courier/warehouses`
            const res = await fetch(url, {
              headers: { 'X-Courier-API-Key': WMS_API_KEY },
            })
            if (res.ok) {
              const data = (await res.json()) as any
              const list = Array.isArray(data) ? data : (data?.data ?? [])
              if (list.length > 0) return reply.send(list)
            }
          } catch (err) {
            request.log?.warn?.(err, 'WMS warehouses API failed, trying UnieWMS DB')
          }
        }

        // 2) Read from UnieWMS database (database: UNIEWMS_DB_NAME, collection: warehouses)
        try {
          const list = await getWarehousesFromUnieWmsDb(stateCode)
          request.log?.info?.({ stateCode, warehouseCount: list.length }, 'Warehouses: uniewms result')
          if (list.length > 0) return reply.send(list)
        } catch (err: any) {
          const msg = err?.message ?? String(err)
          request.log?.warn?.({ err: msg, stateCode }, 'UnieWMS DB warehouses read failed, falling back to local')
        }

        // 3) Fallback: local Warehouse collection in uniecourier DB (stateId)
        const list = await Warehouse.find({ stateId }).sort({ name: 1, code: 1 }).lean()
        return reply.send(list)
      }
    )

    instance.get<{ Querystring: { stateId: string } }>(
      '/api/v1/warehouses/debug',
      async (request: AuthenticatedRequest, reply) => {
        const stateId = (request.query as { stateId?: string }).stateId
        if (!stateId) return reply.code(400).send({ error: 'stateId required' })
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== stateId) {
          return reply.code(403).send({ error: 'State not in scope' })
        }
        const state = await State.findById(stateId).lean()
        const rawCode = state?.code ?? ''
        const stateCode = normalizeStateCodeForWarehouses(rawCode)
        let warehouseCount = 0
        let error: string | null = null
        try {
          const list = await getWarehousesFromUnieWmsDb(stateCode)
          warehouseCount = list.length
        } catch (e: any) {
          error = e?.message ?? String(e)
        }
        return reply.send({
          stateId,
          stateFound: !!state,
          rawCode,
          stateCode,
          uniewmsDbName: UNIEWMS_DB_NAME,
          warehouseCount,
          error,
        })
      }
    )

    instance.get<{ Querystring: { stateId: string } }>(
      '/api/v1/primary-locations',
      async (request: AuthenticatedRequest, reply) => {
        const stateId = (request.query as { stateId?: string }).stateId
        if (!stateId) return reply.code(400).send({ error: 'stateId required' })
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== stateId) {
          return reply.code(403).send({ error: 'State not in scope' })
        }
        const list = await PrimaryLocation.find({ stateId }).sort({ name: 1, code: 1 }).lean()
        return reply.send(list)
      }
    )

    instance.post<{
      Body: { stateId: string; warehouses: Array<{ id: string; code?: string; name?: string; addressStreet?: string; addressCity?: string; addressState?: string; addressZip?: string }> }
    }>('/api/v1/primary-locations', async (request: AuthenticatedRequest, reply) => {
      const body = request.body as any
      if (!body?.stateId) return reply.code(400).send({ error: 'stateId required' })
      if (!Array.isArray(body.warehouses) || body.warehouses.length === 0) {
        return reply.code(400).send({ error: 'warehouses array required and must not be empty' })
      }
      const scope = requireStateScope(request)
      if (request.role !== 'admin' && scope !== body.stateId) {
        return reply.code(403).send({ error: 'State not in scope' })
      }
      const added: any[] = []
      for (const w of body.warehouses) {
        const warehouseId = w.id ?? w._id
        if (!warehouseId) continue
        const existing = await PrimaryLocation.findOne({ stateId: body.stateId, warehouseId: String(warehouseId) })
        if (existing) continue
        const doc = await PrimaryLocation.create({
          stateId: body.stateId,
          warehouseId: String(warehouseId),
          code: w.code ?? undefined,
          name: w.name ?? undefined,
          addressStreet: w.addressStreet ?? undefined,
          addressCity: w.addressCity ?? undefined,
          addressState: w.addressState ?? undefined,
          addressZip: w.addressZip ?? undefined,
        })
        added.push(doc)
      }
      return reply.send({ added: added.length, items: added })
    })

    instance.delete<{ Params: { id: string } }>(
      '/api/v1/primary-locations/:id',
      async (request: AuthenticatedRequest, reply) => {
        const id = (request.params as { id: string }).id
        const doc = await PrimaryLocation.findById(id)
        if (!doc) return reply.code(404).send({ error: 'Primary location not found' })
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== String(doc.stateId)) {
          return reply.code(403).send({ error: 'Not in scope' })
        }
        await PrimaryLocation.findByIdAndDelete(id)
        return reply.send({ ok: true })
      }
    )

    instance.get<{ Querystring: { stateId?: string } }>(
      '/api/v1/hubs',
      async (request: AuthenticatedRequest, reply) => {
        const stateId = (request.query as { stateId?: string }).stateId
        const scope = requireStateScope(request)
        const filter: any = {}
        if (stateId) {
          if (request.role !== 'admin' && scope !== stateId) {
            return reply.code(403).send({ error: 'State not in scope' })
          }
          filter.stateId = stateId
        } else if (request.role !== 'admin' && scope) {
          filter.stateId = scope
        }
        const list = await Hub.find(filter).sort({ name: 1 }).lean()
        return reply.send(list)
      }
    )

    instance.get<{ Params: { id: string } }>(
      '/api/v1/hubs/:id',
      async (request: AuthenticatedRequest, reply) => {
        const id = (request.params as { id: string }).id
        const hub = await Hub.findById(id).lean()
        if (!hub) return reply.code(404).send({ error: 'Hub not found' })
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && hub.stateId && scope !== String(hub.stateId)) {
          return reply.code(403).send({ error: 'Hub not in scope' })
        }
        return reply.send(hub)
      }
    )

    instance.post<{
      Body: {
        stateId?: string
        name: string
        addressLine1: string
        addressLine2?: string
        addressCity: string
        addressState: string
        addressZip: string
        contactName?: string
        contactPhone?: string
        operatingHours?: string
      }
    }>('/api/v1/hubs', async (request: AuthenticatedRequest, reply) => {
      const body = request.body as any
      if (!body?.name?.trim() || !body?.addressLine1?.trim() || !body?.addressCity?.trim() || !body?.addressState?.trim() || !body?.addressZip?.trim()) {
        return reply.code(400).send({ error: 'name, addressLine1, addressCity, addressState, addressZip required' })
      }
      const scope = requireStateScope(request)
      if (body.stateId && request.role !== 'admin' && scope !== body.stateId) {
        return reply.code(403).send({ error: 'State not in scope' })
      }
      const doc = await Hub.create({
        stateId: body.stateId || undefined,
        name: body.name.trim(),
        addressLine1: body.addressLine1.trim(),
        addressLine2: body.addressLine2?.trim(),
        addressCity: body.addressCity.trim(),
        addressState: body.addressState.trim(),
        addressZip: body.addressZip.trim(),
        contactName: body.contactName?.trim(),
        contactPhone: body.contactPhone?.trim(),
        operatingHours: body.operatingHours?.trim(),
      })
      return reply.send(doc)
    })

    instance.patch<{
      Params: { id: string }
      Body: Partial<{
        name: string
        addressLine1: string
        addressLine2: string
        addressCity: string
        addressState: string
        addressZip: string
        contactName: string
        contactPhone: string
        operatingHours: string
        active: boolean
      }>
    }>('/api/v1/hubs/:id', async (request: AuthenticatedRequest, reply) => {
      const id = (request.params as { id: string }).id
      const body = request.body as any
      const hub = await Hub.findById(id)
      if (!hub) return reply.code(404).send({ error: 'Hub not found' })
      const scope = requireStateScope(request)
      if (request.role !== 'admin' && hub.stateId && scope !== String(hub.stateId)) {
        return reply.code(403).send({ error: 'Hub not in scope' })
      }
      if (body.name != null) hub.name = body.name.trim()
      if (body.addressLine1 != null) hub.addressLine1 = body.addressLine1.trim()
      if (body.addressLine2 != null) hub.addressLine2 = body.addressLine2?.trim()
      if (body.addressCity != null) hub.addressCity = body.addressCity.trim()
      if (body.addressState != null) hub.addressState = body.addressState.trim()
      if (body.addressZip != null) hub.addressZip = body.addressZip.trim()
      if (body.contactName != null) hub.contactName = body.contactName?.trim()
      if (body.contactPhone != null) hub.contactPhone = body.contactPhone?.trim()
      if (body.operatingHours != null) hub.operatingHours = body.operatingHours?.trim()
      if (typeof body.active === 'boolean') hub.active = body.active
      await hub.save()
      return reply.send(hub)
    })

    instance.delete<{ Params: { id: string } }>(
      '/api/v1/hubs/:id',
      async (request: AuthenticatedRequest, reply) => {
        const id = (request.params as { id: string }).id
        const hub = await Hub.findById(id)
        if (!hub) return reply.code(404).send({ error: 'Hub not found' })
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && hub.stateId && scope !== String(hub.stateId)) {
          return reply.code(403).send({ error: 'Hub not in scope' })
        }
        await Hub.findByIdAndDelete(id)
        return reply.send({ ok: true })
      }
    )
  })
}
