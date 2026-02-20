import mongoose from 'mongoose'
import { ItemTypeSurcharge } from '../models/ItemTypeSurcharge'
import { WeightSizeTier } from '../models/WeightSizeTier'
import { ItemTypeVehicleRule } from '../models/ItemTypeVehicleRule'
import { ServiceAreaZip } from '../models/ServiceAreaZip'
import { State } from '../models/State'
import { Hub } from '../models/Hub'
import { Warehouse } from '../models/Warehouse'
import { PrimaryLocation } from '../models/PrimaryLocation'

export interface RateShopInput {
  stateId?: string
  zipCode: string
  weightLbs: number
  lengthIn?: number
  widthIn?: number
  heightIn?: number
  itemType: string
}

/** Result of resolving a ZIP to a state we serve. */
export interface ResolveZipResult {
  stateId: string
  stateCode: string
  stateName: string
  city?: string
}

/** ZIP resolved to a location we do not serve (state not configured or unknown). */
export interface ResolveZipNoService {
  noService: true
  city?: string
  stateName?: string
  stateCode?: string
  error?: string
}

export interface RateShopBreakdown {
  step: string
  value: string
  cents?: number
}

export interface RateShopDropOffLocation {
  type: 'hub' | 'warehouse'
  name: string
  address?: string
  city?: string
  state?: string
  zip?: string
}

export interface RateShopResult {
  totalCents: number
  totalDollars: string
  breakdown: RateShopBreakdown[]
  stateId: string
  zipCode: string
  itemType: string
  vehicleType?: string
  tier?: number
  error?: string
  /** When true, we do not deliver to this city/state (state not configured). */
  noService?: boolean
  city?: string
  stateName?: string
  stateCode?: string
  /** State hubs and warehouses (origin / drop-off locations). */
  dropOffLocations?: RateShopDropOffLocation[]
}

function normalizeZip(z: string): string {
  const digits = String(z).replace(/\D/g, '').slice(0, 5)
  return digits.length >= 3 ? digits.padStart(5, '0') : ''
}

/** Origin option for create-shipment form (hub, warehouse, or primary location). */
export interface OriginOption {
  id: string
  type: 'hub' | 'warehouse'
  name: string
  address: string
}

/**
 * Get origin options (hubs + warehouses + primary locations) for a destination ZIP.
 * Same logic as rate-shop: resolve state from ZIP, then fetch all drop-off locations.
 */
export async function getOriginOptionsForZip(
  zip: string
): Promise<
  | { stateId: string; stateCode: string; stateName: string; origins: OriginOption[] }
  | { noService: true; error?: string }
> {
  const resolved = await resolveStateFromZip(zip)
  if ('noService' in resolved && resolved.noService) {
    return { noService: true, error: resolved.error ?? 'We do not deliver to this ZIP.' }
  }
  const stateId = (resolved as ResolveZipResult).stateId
  const [hubs, warehouses, primaryLocations] = await Promise.all([
    Hub.find({ stateId, active: true }).select('name addressLine1 addressLine2 addressCity addressState addressZip').sort({ name: 1 }).lean(),
    Warehouse.find({ stateId }).select('name addressStreet addressCity addressState addressZip code').lean(),
    PrimaryLocation.find({ stateId }).select('name addressStreet addressCity addressState addressZip code').lean(),
  ])
  const origins: OriginOption[] = [
    ...(hubs as any[]).map((h) => ({
      id: String(h._id),
      type: 'hub' as const,
      name: h.name,
      address: [h.addressLine1, h.addressLine2, h.addressCity, h.addressState, h.addressZip].filter(Boolean).join(', '),
    })),
    ...(warehouses as any[]).map((w) => ({
      id: `warehouse:${(w as any)._id}`,
      type: 'warehouse' as const,
      name: w.name || w.code || 'Warehouse',
      address: [w.addressStreet, w.addressCity, w.addressState, w.addressZip].filter(Boolean).join(', '),
    })),
    ...(primaryLocations as any[]).map((p) => ({
      id: `primary:${(p as any)._id}`,
      type: 'warehouse' as const,
      name: p.name || p.code || 'Primary location',
      address: [p.addressStreet, p.addressCity, p.addressState, p.addressZip].filter(Boolean).join(', '),
    })),
  ]
  return {
    stateId,
    stateCode: (resolved as ResolveZipResult).stateCode,
    stateName: (resolved as ResolveZipResult).stateName,
    origins,
  }
}

/**
 * Resolve destination ZIP to a state we serve. Uses ServiceAreaZip first, then
 * zippopotam to get state/city and checks if that state has service areas & fees configured.
 */
export async function resolveStateFromZip(
  zip: string
): Promise<ResolveZipResult | ResolveZipNoService> {
  const normalized = normalizeZip(zip)
  if (!normalized) {
    return { noService: true, error: 'Invalid destination ZIP' }
  }

  // 1) ZIP in our service area → we serve that state (try both 5-digit and numeric form)
  const zipVariants = [normalized]
  if (/^0+/.test(normalized)) {
    zipVariants.push(normalized.replace(/^0+/, '') || normalized)
  } else {
    zipVariants.push(normalized.padStart(5, '0'))
  }
  const inArea = await ServiceAreaZip.findOne({ zipCode: { $in: zipVariants } }).select('stateId').lean()
  if (inArea?.stateId) {
    const state = await State.findById(inArea.stateId).lean()
    if (state) {
      return {
        stateId: (state as any)._id.toString(),
        stateCode: (state as any).code,
        stateName: (state as any).name,
      }
    }
  }

  // 2) Look up ZIP location via zippopotam (try 5-digit first, then without leading zeros)
  let stateAbbr: string | null = null
  let city: string | undefined
  let stateFullName: string | undefined
  const zipForFetch = normalized
  let res: Response | null = null
  try {
    res = await fetch(`https://api.zippopotam.us/us/${zipForFetch}`)
    if (!res.ok && /^0+/.test(normalized)) {
      const altZip = normalized.replace(/^0+/, '') || normalized
      res = await fetch(`https://api.zippopotam.us/us/${altZip}`)
    }
    if (!res?.ok) {
      return { noService: true, error: 'Unknown or invalid ZIP code' }
    }
    const data = (await res.json()) as {
      places?: Array<{ 'place name'?: string; 'state abbreviation'?: string; state?: string }>
    }
    const place = data?.places?.[0]
    if (!place) {
      return { noService: true, error: 'Unknown or invalid ZIP code' }
    }
    stateAbbr = (place['state abbreviation'] ?? place.state) ?? null
    city = place['place name']
    stateFullName = place.state
  } catch {
    return { noService: true, error: 'Could not look up ZIP code' }
  }

  if (!stateAbbr) {
    return { noService: true, city, error: 'Unknown or invalid ZIP code' }
  }

  // State lookup: case-insensitive so we match NJ, nj, Nj
  const stateCodeRegex = new RegExp(`^${String(stateAbbr).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
  const state = await State.findOne({ code: stateCodeRegex }).lean()
  if (!state) {
    return {
      noService: true,
      city,
      stateName: stateFullName ?? stateAbbr,
      stateCode: stateAbbr,
    }
  }

  const stateId = (state as any)._id
  const hasTiers = await WeightSizeTier.exists({ stateId })
  const hasServiceZips = await ServiceAreaZip.exists({ stateId })
  if (!hasTiers && !hasServiceZips) {
    return {
      noService: true,
      city,
      stateName: (state as any).name,
      stateCode: (state as any).code,
    }
  }

  return {
    stateId: stateId.toString(),
    stateCode: (state as any).code,
    stateName: (state as any).name,
    city,
  }
}

export async function calculateRate(input: RateShopInput): Promise<RateShopResult> {
  const breakdown: RateShopBreakdown[] = []
  const zip = normalizeZip(input.zipCode)
  if (!zip) {
    return {
      totalCents: 0,
      totalDollars: '0.00',
      breakdown: [],
      stateId: input.stateId ?? '',
      zipCode: input.zipCode,
      itemType: input.itemType,
      error: 'Invalid destination ZIP',
    }
  }
  if (!input.stateId) {
    return {
      totalCents: 0,
      totalDollars: '0.00',
      breakdown: [],
      stateId: '',
      zipCode: zip,
      itemType: input.itemType,
      error: 'State is required; use resolveStateFromZip when only ZIP is provided.',
    }
  }

  const stateId = new mongoose.Types.ObjectId(input.stateId)

  // Check if ZIP is in this state's service area; if not, we still use state default for surcharge
  const inServiceArea = await ServiceAreaZip.exists({ stateId, zipCode: zip })

  // 1) Surcharge: try ZIP-level then state default (single combined line added after we compute add)
  let surcharge: { costDollars?: number; type: string; value: number; zipCode?: string } | null = null
  const zipSurcharge = await ItemTypeSurcharge.findOne({ stateId, zipCode: zip, itemType: input.itemType, active: true }).lean()
  if (zipSurcharge) {
    surcharge = zipSurcharge as any
  }
  if (!surcharge) {
    const stateSurcharge = await ItemTypeSurcharge.findOne({
      stateId,
      $or: [{ zipCode: '' }, { zipCode: null }, { zipCode: { $exists: false } }],
      itemType: input.itemType,
      active: true,
    }).lean()
    if (stateSurcharge) {
      surcharge = stateSurcharge as any
    }
  }

  // Support legacy costCents/valueCents for migration; prefer new costDollars/value
  const baseCostDollars = surcharge?.costDollars ?? (surcharge && (surcharge as any).costCents != null ? (surcharge as any).costCents / 100 : undefined)
  const baseCostCents = baseCostDollars != null ? Math.round(baseCostDollars * 100) : 0
  if (surcharge == null) {
    breakdown.push({ step: 'Base cost', value: 'Not configured for this item type / ZIP', cents: 0 })
  }

  // 2) Tier: find matching tier. If weight OR length OR width OR height exceeds the tier's max, move up to next tier.
  const tiers = await WeightSizeTier.find({ stateId }).sort({ tier: 1 }).lean()
  let tierPlusCents = 0
  let matchedTier: number | undefined
  const weightLbs = Number(input.weightLbs) || 0
  const lengthIn = input.lengthIn != null ? Number(input.lengthIn) : null
  const widthIn = input.widthIn != null ? Number(input.widthIn) : null
  const heightIn = input.heightIn != null ? Number(input.heightIn) : null

  for (const t of tiers) {
    const minLbs = t.minWeightLbs != null ? Number(t.minWeightLbs) : 0
    const maxLbs = t.maxWeightLbs != null ? Number(t.maxWeightLbs) : Infinity
    if (weightLbs < minLbs) continue
    if (weightLbs > maxLbs) continue
    // Any dimension exceeding the tier's max → skip this tier (move up)
    if (t.maxLengthIn != null && lengthIn != null && lengthIn > t.maxLengthIn) continue
    if (t.maxWidthIn != null && widthIn != null && widthIn > t.maxWidthIn) continue
    if (t.maxHeightIn != null && heightIn != null && heightIn > t.maxHeightIn) continue
    tierPlusCents = t.plusCents ?? 0
    matchedTier = t.tier
    breakdown.push({ step: `Tier ${t.tier} (weight/dims)`, value: `+$${((t.plusCents ?? 0) / 100).toFixed(2)}`, cents: t.plusCents ?? 0 })
    break
  }

  let totalCents = baseCostCents + tierPlusCents

  // 3) Apply surcharge (percent or flat) — one combined line for surcharge (state default or ZIP)
  // value: percent = e.g. 15 = 15%; flat = dollars
  if (surcharge && totalCents > 0) {
    const rawValue = surcharge.value ?? ((surcharge as any).valueCents != null ? ((surcharge as any).type === 'percent' ? (surcharge as any).valueCents : (surcharge as any).valueCents / 100) : 0)
    const add = surcharge.type === 'percent'
      ? Math.round((totalCents * rawValue) / 100)
      : Math.round(Number(rawValue) * 100)
    totalCents += add
    const surchargeCents = baseCostCents + add
    const step = surcharge.zipCode ? 'Surcharge (ZIP)' : 'ZIP code delivery cost'
    const value = surcharge.zipCode ? `ZIP ${zip}` : 'State default'
    breakdown.push({ step, value, cents: surchargeCents })
  }

  // 4) Vehicle type (for display only; we do not apply vehicle minimum to the rate)
  const vehicleRule = await ItemTypeVehicleRule.findOne({ stateId, itemType: input.itemType }).lean()
  const vehicleType = vehicleRule?.vehicleType ?? (input.itemType === 'parcel' ? 'car' : 'van')

  // 5) Reverse lookup: ZIP belongs to this state; show drop-off locations (hubs + warehouses) linked to that state.
  // State is resolved from ZIP in the route (ServiceAreaZip or zippopotam); we use that stateId for locations.
  const stateIdForLocations = input.stateId
  const [hubs, warehouses, primaryLocations, stateDoc] = await Promise.all([
    Hub.find({ stateId: stateIdForLocations, active: true }).select('name addressLine1 addressLine2 addressCity addressState addressZip').lean(),
    Warehouse.find({ stateId: stateIdForLocations }).select('name addressStreet addressCity addressState addressZip').lean(),
    PrimaryLocation.find({ stateId: stateIdForLocations }).select('name code addressStreet addressCity addressState addressZip').lean(),
    State.findById(stateIdForLocations).select('code name').lean(),
  ])
  const stateCode = (stateDoc as any)?.code ?? ''
  const stateName = (stateDoc as any)?.name ?? ''
  const dropOffLocations: RateShopDropOffLocation[] = [
    ...(hubs as any[]).map((h) => ({
      type: 'hub' as const,
      name: h.name,
      address: [h.addressLine1, h.addressLine2].filter(Boolean).join(', '),
      city: h.addressCity,
      state: h.addressState,
      zip: h.addressZip,
    })),
    ...(warehouses as any[]).map((w) => ({
      type: 'warehouse' as const,
      name: w.name || w.code || 'Warehouse',
      address: w.addressStreet,
      city: w.addressCity,
      state: w.addressState,
      zip: w.addressZip,
    })),
    ...(primaryLocations as any[]).map((p) => ({
      type: 'warehouse' as const,
      name: p.name || p.code || 'Warehouse',
      address: p.addressStreet,
      city: p.addressCity,
      state: p.addressState,
      zip: p.addressZip,
    })),
  ]

  return {
    totalCents,
    totalDollars: (totalCents / 100).toFixed(2),
    breakdown,
    stateId: input.stateId,
    stateCode,
    stateName,
    zipCode: zip,
    itemType: input.itemType,
    vehicleType,
    tier: matchedTier,
    dropOffLocations,
    ...(inServiceArea ? {} : { error: 'ZIP not in service area for this state; rate uses state default.' }),
  }
}
