import { FastifyInstance } from 'fastify'
import { authMiddleware, requireRole, requireStateScope, type AuthenticatedRequest } from '../middleware/auth'
import { getNationalSummary, getStateMetrics, getMapData, getDispatchSummary } from '../repos/dashboard.repo'
import { listStates } from '../repos/states.repo'
import { Warehouse } from '../models/Warehouse'
import { Hub } from '../models/Hub'
import { PrimaryLocation } from '../models/PrimaryLocation'

async function geocodeAddress(address: string): Promise<{ lat: number; lon: number } | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`,
      { headers: { 'User-Agent': 'UnieCourierWMS/1.0' } }
    )
    if (!res.ok) return null
    const data = await res.json()
    const item = Array.isArray(data) ? data[0] : null
    const lat = item?.lat != null ? parseFloat(item.lat) : undefined
    const lon = item?.lon != null ? parseFloat(item.lon) : undefined
    if (lat != null && lon != null) return { lat, lon }
  } catch {
    // ignore
  }
  return null
}

export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (instance) => {
    instance.addHook('preHandler', authMiddleware)
    instance.addHook('preHandler', requireRole('admin', 'manager', 'dispatcher'))

    instance.get('/api/v1/dashboard/summary', async (request: AuthenticatedRequest, reply) => {
      const scope = requireStateScope(request)
      const rows = await getNationalSummary()
      if (request.role !== 'admin') {
        const filtered = scope ? rows.filter((r) => r.state_id === scope) : []
        return reply.send(filtered)
      }
      return reply.send(rows)
    })

    instance.get<{ Querystring: { stateId?: string } }>(
      '/api/v1/dashboard/dispatch-summary',
      async (request: AuthenticatedRequest, reply) => {
        const q = request.query as { stateId?: string }
        const h = request.headers['x-state-id']
        let stateIdRaw = q?.stateId ?? (Array.isArray(h) ? h[0] : h) ?? request.stateId
        const scope = requireStateScope(request)
        if (stateIdRaw === 'all') {
          if (request.role !== 'admin' && scope) stateIdRaw = scope
          else if (request.role !== 'admin') return reply.code(403).send({ error: 'All states requires admin role' })
        }
        const stateId = typeof stateIdRaw === 'string' ? stateIdRaw : null
        if (!stateId) return reply.code(400).send({ error: 'stateId required' })
        if (request.role !== 'admin' && scope !== stateId) return reply.code(403).send({ error: 'State not in scope' })
        const summary = await getDispatchSummary(stateId)
        return reply.send(summary)
      }
    )

    instance.get<{ Querystring: { stateId?: string } }>(
      '/api/v1/dashboard/state-metrics',
      async (request: AuthenticatedRequest, reply) => {
        const q = request.query as { stateId?: string }
        const h = request.headers['x-state-id']
        let stateIdRaw = q?.stateId ?? (Array.isArray(h) ? h[0] : h) ?? request.stateId
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
        if (stateId === 'all') {
          const states = await listStates()
          const allMetrics = await Promise.all(states.map((s) => getStateMetrics(s.id)))
          const aggregated = allMetrics.reduce(
            (acc, m) => ({
              available: (acc.available ?? 0) + (m.available ?? 0),
              assigned: (acc.assigned ?? 0) + (m.assigned ?? 0),
              inProgress: (acc.inProgress ?? 0) + (m.inProgress ?? 0),
              completedToday: (acc.completedToday ?? 0) + (m.completedToday ?? 0),
              failedStops: (acc.failedStops ?? 0) + (m.failedStops ?? 0),
              avgStopsPerRoute: acc.avgStopsPerRoute ?? 0,
              avgMilesPerRoute: acc.avgMilesPerRoute ?? 0,
              costPerStop: acc.costPerStop ?? 0,
              driverAcceptanceRate: acc.driverAcceptanceRate ?? 0,
            }),
            {} as Record<string, number>
          )
          return reply.send(aggregated)
        }
        const metrics = await getStateMetrics(stateId)
        return reply.send(metrics)
      }
    )

    instance.get('/api/v1/dashboard/map-data', async (request: AuthenticatedRequest, reply) => {
      const scope = requireStateScope(request)
      const rows = await getMapData()
      if (request.role !== 'admin') {
        const filtered = scope ? rows.filter((r) => r.state_id === scope) : []
        return reply.send(filtered)
      }
      return reply.send(rows)
    })

    instance.get<{ Querystring: { stateId: string } }>(
      '/api/v1/dashboard/map-locations',
      async (request: AuthenticatedRequest, reply) => {
        const stateId = (request.query as { stateId?: string }).stateId
        if (!stateId) return reply.code(400).send({ error: 'stateId required' })
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== stateId) {
          return reply.code(403).send({ error: 'State not in scope' })
        }
        const [warehouses, hubs, primaryLocations] = await Promise.all([
          Warehouse.find({ stateId }).lean(),
          Hub.find({ stateId, active: true }).lean(),
          PrimaryLocation.find({ stateId }).lean(),
        ])
        const outWarehouses: any[] = []
        const outHubs: any[] = []
        const outPrimary: any[] = []
        for (const w of warehouses) {
          let lat = (w as any).lat
          let lon = (w as any).lon
          if (lat == null || lon == null) {
            const parts = [
              (w as any).addressStreet,
              (w as any).addressCity,
              (w as any).addressState,
              (w as any).addressZip,
              'USA',
            ].filter(Boolean)
            const coords = await geocodeAddress(parts.join(', '))
            if (coords) {
              lat = coords.lat
              lon = coords.lon
              await Warehouse.updateOne({ _id: w._id }, { $set: { lat, lon } })
            }
            await new Promise((r) => setTimeout(r, 1100))
          }
          outWarehouses.push({
            id: String(w._id),
            name: (w as any).name || (w as any).code || 'Warehouse',
            address: [(w as any).addressStreet, (w as any).addressCity, (w as any).addressState, (w as any).addressZip].filter(Boolean).join(', '),
            lat: lat ?? undefined,
            lon: lon ?? undefined,
          })
        }
        for (const h of hubs) {
          let lat = (h as any).lat
          let lon = (h as any).lon
          if (lat == null || lon == null) {
            const parts = [
              (h as any).addressLine1,
              (h as any).addressCity,
              (h as any).addressState,
              (h as any).addressZip,
              'USA',
            ].filter(Boolean)
            const coords = await geocodeAddress(parts.join(', '))
            if (coords) {
              lat = coords.lat
              lon = coords.lon
              await Hub.updateOne({ _id: h._id }, { $set: { lat, lon } })
            }
            await new Promise((r) => setTimeout(r, 1100))
          }
          outHubs.push({
            id: String(h._id),
            name: (h as any).name,
            address: [(h as any).addressLine1, (h as any).addressCity, (h as any).addressState, (h as any).addressZip].filter(Boolean).join(', '),
            lat: lat ?? undefined,
            lon: lon ?? undefined,
          })
        }
        for (const pl of primaryLocations) {
          const parts = [
            (pl as any).addressStreet,
            (pl as any).addressCity,
            (pl as any).addressState,
            (pl as any).addressZip,
            'USA',
          ].filter(Boolean)
          if (parts.length < 2) continue
          let lat: number | undefined
          let lon: number | undefined
          const coords = await geocodeAddress(parts.join(', '))
          if (coords) {
            lat = coords.lat
            lon = coords.lon
          }
          await new Promise((r) => setTimeout(r, 1100))
          outPrimary.push({
            id: String(pl._id),
            name: (pl as any).name || (pl as any).code || 'Primary location',
            address: [(pl as any).addressStreet, (pl as any).addressCity, (pl as any).addressState, (pl as any).addressZip].filter(Boolean).join(', '),
            lat: lat ?? undefined,
            lon: lon ?? undefined,
          })
        }
        return reply.send({ warehouses: outWarehouses, hubs: outHubs, primaryLocations: outPrimary })
      }
    )

    // ZCTA (ZIP Code Tabulation Area) boundaries – U.S. Census Bureau / OpenDataDE pre-converted GeoJSON
    instance.get<{ Querystring: { stateCode: string } }>(
      '/api/v1/dashboard/zip-boundaries',
      async (request: AuthenticatedRequest, reply) => {
        const stateCode = (request.query as { stateCode?: string }).stateCode?.trim()?.toUpperCase()
        if (!stateCode || stateCode.length !== 2) return reply.code(400).send({ error: 'stateCode required (2-letter)' })
        // OpenDataDE: pre-converted GeoJSON for all 50 states + D.C. (Census ZCTA data, easier for web)
        const openDataDeFiles: Record<string, string> = {
          AL: 'al_alabama_zip_codes_geo.min.json', AK: 'ak_alaska_zip_codes_geo.min.json', AZ: 'az_arizona_zip_codes_geo.min.json',
          AR: 'ar_arkansas_zip_codes_geo.min.json', CA: 'ca_california_zip_codes_geo.min.json', CO: 'co_colorado_zip_codes_geo.min.json',
          CT: 'ct_connecticut_zip_codes_geo.min.json', DE: 'de_delaware_zip_codes_geo.min.json', FL: 'fl_florida_zip_codes_geo.min.json',
          GA: 'ga_georgia_zip_codes_geo.min.json', HI: 'hi_hawaii_zip_codes_geo.min.json', ID: 'id_idaho_zip_codes_geo.min.json',
          IL: 'il_illinois_zip_codes_geo.min.json', IN: 'in_indiana_zip_codes_geo.min.json', IA: 'ia_iowa_zip_codes_geo.min.json',
          KS: 'ks_kansas_zip_codes_geo.min.json', KY: 'ky_kentucky_zip_codes_geo.min.json', LA: 'la_louisiana_zip_codes_geo.min.json',
          ME: 'me_maine_zip_codes_geo.min.json', MD: 'md_maryland_zip_codes_geo.min.json', MA: 'ma_massachusetts_zip_codes_geo.min.json',
          MI: 'mi_michigan_zip_codes_geo.min.json', MN: 'mn_minnesota_zip_codes_geo.min.json', MS: 'ms_mississippi_zip_codes_geo.min.json',
          MO: 'mo_missouri_zip_codes_geo.min.json', MT: 'mt_montana_zip_codes_geo.min.json', NE: 'ne_nebraska_zip_codes_geo.min.json',
          NV: 'nv_nevada_zip_codes_geo.min.json', NH: 'nh_new_hampshire_zip_codes_geo.min.json', NJ: 'nj_new_jersey_zip_codes_geo.min.json',
          NM: 'nm_new_mexico_zip_codes_geo.min.json', NY: 'ny_new_york_zip_codes_geo.min.json', NC: 'nc_north_carolina_zip_codes_geo.min.json',
          ND: 'nd_north_dakota_zip_codes_geo.min.json', OH: 'oh_ohio_zip_codes_geo.min.json', OK: 'ok_oklahoma_zip_codes_geo.min.json',
          OR: 'or_oregon_zip_codes_geo.min.json', PA: 'pa_pennsylvania_zip_codes_geo.min.json', RI: 'ri_rhode_island_zip_codes_geo.min.json',
          SC: 'sc_south_carolina_zip_codes_geo.min.json', SD: 'sd_south_dakota_zip_codes_geo.min.json', TN: 'tn_tennessee_zip_codes_geo.min.json',
          TX: 'tx_texas_zip_codes_geo.min.json', UT: 'ut_utah_zip_codes_geo.min.json', VT: 'vt_vermont_zip_codes_geo.min.json',
          VA: 'va_virginia_zip_codes_geo.min.json', WA: 'wa_washington_zip_codes_geo.min.json', WV: 'wv_west_virginia_zip_codes_geo.min.json',
          WI: 'wi_wisconsin_zip_codes_geo.min.json', WY: 'wy_wyoming_zip_codes_geo.min.json', DC: 'dc_district_of_columbia_zip_codes_geo.min.json',
        }
        const base = 'https://raw.githubusercontent.com/OpenDataDE/State-zip-code-GeoJSON/master'
        const urls: string[] = []
        if (openDataDeFiles[stateCode]) urls.push(`${base}/${openDataDeFiles[stateCode]}`)
        urls.push(
          `${base}/${stateCode.toLowerCase()}_zips.json`,
          `https://raw.githubusercontent.com/themorrisonagency/us-zipcode-geojson/main/states/${stateCode.toLowerCase()}.geojson`,
          `https://raw.githubusercontent.com/rossby-info/_rossby_usa_zcta_geojson/main/state/${stateCode.toLowerCase()}.geojson`
        )
        for (const url of urls) {
          try {
            const res = await fetch(url)
            if (!res.ok) continue
            const data = (await res.json()) as { type?: string; features?: unknown[] } | unknown[]
            let features: unknown[] = []
            if (Array.isArray(data)) features = data
            else if (data && typeof data === 'object' && Array.isArray((data as any).features)) {
              features = (data as any).features
            }
            if (features.length > 0) {
              return reply.send({ type: 'FeatureCollection', features })
            }
          } catch {
            // try next
          }
        }
        return reply.code(404).send({ error: 'No ZCTA boundaries found for this state' })
      }
    )
  })
}
