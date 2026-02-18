import { FastifyInstance } from 'fastify'
import { calculateRate, getOriginOptionsForZip, resolveStateFromZip } from '../services/rate-shop.service'

const NO_SERVICE_MESSAGE = 'We currently do not deliver in this city and state.'

export async function registerRateShopRoutes(app: FastifyInstance): Promise<void> {
  // Public endpoint: get origin options (hubs + warehouses + primary locations) for a destination ZIP.
  // Same logic as rate-shop: resolve state from ZIP, fetch all drop-off locations.
  app.get<{ Querystring: { zip: string } }>(
    '/api/v1/origin-options',
    async (request, reply) => {
      const zip = String((request.query as { zip?: string }).zip || '').replace(/\D/g, '').slice(0, 5)
      if (zip.length < 3) return reply.code(400).send({ error: 'Valid ZIP required (at least 3 digits)' })
      try {
        const result = await getOriginOptionsForZip(zip)
        if ('noService' in result) {
          return reply.code(400).send({ error: result.error ?? 'We do not deliver to this ZIP.' })
        }
        return reply.send({
          stateId: result.stateId,
          stateCode: result.stateCode,
          stateName: result.stateName,
          hubs: result.origins,
        })
      } catch (e) {
        request.log?.error?.(e, 'origin-options failed')
        return reply.code(500).send({ error: 'Could not look up origin options' })
      }
    }
  )

  // Public endpoint: no auth required. stateId is optional; when omitted, state is resolved from ZIP.
  app.post<{
    Body: { stateId?: string; zipCode: string; weightLbs: number; lengthIn?: number; widthIn?: number; heightIn?: number; itemType: string }
  }>('/api/v1/rate-shop', async (request, reply) => {
    const body = request.body as any
    request.log?.info?.({ body, zipCode: body?.zipCode, weightLbs: body?.weightLbs }, 'rate-shop request')
    if (!body?.zipCode?.trim() || body?.weightLbs == null) {
      request.log?.warn?.('rate-shop missing zipCode or weightLbs')
      return reply.code(400).send({ error: 'zipCode and weightLbs required' })
    }
    const zipCode = String(body.zipCode).trim()
    const weightLbs = Number(body.weightLbs)
    const itemType = String(body.itemType || 'parcel').toLowerCase()
    if (!['parcel', 'freight', 'bulk', 'hazmat'].includes(itemType)) {
      return reply.code(400).send({ error: 'itemType must be parcel, freight, bulk, or hazmat' })
    }

    let stateId: string | undefined = body?.stateId ? String(body.stateId).trim() : undefined
    if (!stateId) {
      try {
        request.log?.info?.({ zipCode }, 'rate-shop resolving state from ZIP')
        const resolved = await resolveStateFromZip(zipCode)
        if ('noService' in resolved && resolved.noService) {
          request.log?.info?.({ zipCode, noService: true, error: resolved.error }, 'rate-shop noService')
          return reply.send({
            totalCents: 0,
            totalDollars: '0.00',
            breakdown: [],
            stateId: '',
            zipCode,
            itemType,
            error: resolved.error ?? NO_SERVICE_MESSAGE,
            noService: true,
            city: resolved.city,
            stateName: resolved.stateName,
            stateCode: resolved.stateCode,
          })
        }
        stateId = (resolved as { stateId: string }).stateId
        request.log?.info?.({ zipCode, stateId }, 'rate-shop state resolved')
      } catch (e) {
        request.log?.error?.(e, 'rate-shop resolveStateFromZip failed')
        return reply.code(500).send({ error: 'Could not look up destination' })
      }
    }

    try {
      const result = await calculateRate({
        stateId,
        zipCode,
        weightLbs: Number.isFinite(weightLbs) ? weightLbs : 0,
        lengthIn: body.lengthIn != null ? Number(body.lengthIn) : undefined,
        widthIn: body.widthIn != null ? Number(body.widthIn) : undefined,
        heightIn: body.heightIn != null ? Number(body.heightIn) : undefined,
        itemType,
      })
      request.log?.info?.({ zipCode, stateId, totalDollars: result.totalDollars, dropOffCount: result.dropOffLocations?.length }, 'rate-shop result')
      return reply.send(result)
    } catch (e) {
      request.log?.error?.(e, 'rate-shop calculateRate failed')
      return reply.code(500).send({ error: 'Rate calculation failed' })
    }
  })
}
