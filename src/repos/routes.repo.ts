import mongoose from 'mongoose'
import { Route } from '../models/Route'
import { RouteStop } from '../models/RouteStop'
import { RouteStatusLog } from '../models/RouteStatusLog'
import { ZipCentroid } from '../models/ZipCentroid'
import type { RouteStatus } from '../types'

export interface RouteRow {
  id: string
  state_id: string
  status: RouteStatus
  vehicle_filter: string | null
  total_driver_payout_cents: number
  total_client_charge_cents: number
  margin_cents: number
  assigned_driver_id: string | null
  available_at: Date | null
  assigned_at: Date | null
  started_at: Date | null
  completed_at: Date | null
  created_at: Date
  updated_at: Date
}

export interface RouteStopRow {
  id: string
  route_id: string
  order_id: string
  sequence: number
  address_line1: string
  address_city: string | null
  address_state: string | null
  address_zip: string
  pod_s3_key: string | null
  status: string
  completed_at: Date | null
}

function toRouteRow(d: any): RouteRow {
  return {
    id: String(d._id),
    state_id: String(d.stateId),
    status: d.status,
    vehicle_filter: d.vehicleFilter ?? null,
    total_driver_payout_cents: d.totalDriverPayoutCents,
    total_client_charge_cents: d.totalClientChargeCents,
    margin_cents: d.marginCents,
    assigned_driver_id: d.assignedDriverId ? String(d.assignedDriverId) : null,
    available_at: d.availableAt ?? null,
    assigned_at: d.assignedAt ?? null,
    started_at: d.startedAt ?? null,
    completed_at: d.completedAt ?? null,
    created_at: d.createdAt,
    updated_at: d.updatedAt,
  }
}

function toStopRow(d: any): RouteStopRow {
  return {
    id: String(d._id),
    route_id: String(d.routeId),
    order_id: String(d.orderId),
    sequence: d.sequence,
    address_line1: d.addressLine1,
    address_city: d.addressCity ?? null,
    address_state: d.addressState ?? null,
    address_zip: d.addressZip,
    pod_s3_key: d.podS3Key ?? null,
    status: d.status,
    completed_at: d.completedAt ?? null,
  }
}

export async function createRoute(data: {
  stateId: string
  vehicleFilter?: string
  totalDriverPayoutCents: number
  totalClientChargeCents: number
  marginCents: number
}): Promise<string> {
  const doc = await Route.create({
    stateId: data.stateId,
    status: 'available',
    vehicleFilter: data.vehicleFilter,
    totalDriverPayoutCents: data.totalDriverPayoutCents,
    totalClientChargeCents: data.totalClientChargeCents,
    marginCents: data.marginCents,
  })
  return String(doc._id)
}

export async function addRouteStop(data: {
  routeId: string
  orderId: string
  sequence: number
  addressLine1: string
  addressCity?: string
  addressState?: string
  addressZip: string
}): Promise<string> {
  const doc = await RouteStop.create({
    routeId: data.routeId,
    orderId: data.orderId,
    sequence: data.sequence,
    addressLine1: data.addressLine1,
    addressCity: data.addressCity,
    addressState: data.addressState,
    addressZip: data.addressZip,
  })
  return String(doc._id)
}

export async function getRouteById(id: string): Promise<RouteRow | null> {
  const doc = await Route.findById(id).lean()
  if (!doc) return null
  return toRouteRow(doc)
}

export async function getRouteStops(routeId: string): Promise<RouteStopRow[]> {
  const docs = await RouteStop.find({ routeId }).sort({ sequence: 1 }).lean()
  return docs.map(toStopRow)
}

export async function listRoutesByState(
  stateId: string,
  status?: RouteStatus
): Promise<RouteRow[]> {
  const q: any = {}
  if (stateId && stateId !== 'all') q.stateId = stateId
  if (status) q.status = status
  const docs = await Route.find(q).sort({ createdAt: -1 }).lean()
  return docs.map(toRouteRow)
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

async function getRouteCentroid(routeId: string): Promise<{ lat: number; lon: number } | null> {
  const stops = await RouteStop.find({ routeId }).lean()
  const zips = [...new Set(stops.map((s) => s.addressZip))]
  if (zips.length === 0) return null
  const coords = await ZipCentroid.find({ zip: { $in: zips } }).lean()
  if (!coords.length) return null
  const sum = coords.reduce(
    (a, b) => ({ lat: a.lat + b.lat, lon: a.lon + b.lon }),
    { lat: 0, lon: 0 }
  )
  return { lat: sum.lat / coords.length, lon: sum.lon / coords.length }
}

export async function listAvailableRoutesForDriver(
  stateId: string,
  driverZipList: string[],
  driverZipLatLons: { zip: string; lat: number; lon: number }[],
  radiusMiles: number
): Promise<RouteRow[]> {
  const idsFromZip = new Set<string>()
  if (driverZipList.length > 0) {
    const stops = await RouteStop.aggregate([
      { $match: { addressZip: { $in: driverZipList } } },
      { $group: { _id: '$routeId' } },
    ])
    stops.forEach((s: any) => idsFromZip.add(String(s._id)))
  }
  if (driverZipList.length === 0 && driverZipLatLons.length === 0) return []
  if (driverZipList.length > 0 && driverZipLatLons.length === 0) {
    const docs = await Route.find({
      stateId,
      status: 'available',
      _id: { $in: Array.from(idsFromZip).map((id) => new mongoose.Types.ObjectId(id)) },
    })
      .sort({ availableAt: 1 })
      .lean()
    return docs.map(toRouteRow)
  }
  const allDocs = await Route.find({ stateId, status: 'available' })
    .sort({ availableAt: 1 })
    .lean()
  const routeIdsWithinRadius = new Set<string>()
  for (const route of allDocs) {
    if (idsFromZip.has(String(route._id))) {
      routeIdsWithinRadius.add(String(route._id))
      continue
    }
    const centroid = await getRouteCentroid(String(route._id))
    if (!centroid) continue
    for (const dz of driverZipLatLons) {
      if (haversineMiles(dz.lat, dz.lon, centroid.lat, centroid.lon) <= radiusMiles) {
        routeIdsWithinRadius.add(String(route._id))
        break
      }
    }
  }
  return allDocs
    .filter((r) => routeIdsWithinRadius.has(String(r._id)))
    .map(toRouteRow)
}

export async function assignRoute(routeId: string, driverId: string): Promise<boolean> {
  const res = await Route.updateOne(
    { _id: routeId, status: 'available' },
    {
      status: 'assigned',
      assignedDriverId: driverId,
      assignedAt: new Date(),
    }
  )
  if (res.modifiedCount) {
    await RouteStatusLog.create({
      routeId,
      fromStatus: 'available',
      toStatus: 'assigned',
      actorType: 'system',
    })
    return true
  }
  return false
}

export async function startRoute(routeId: string, driverId: string): Promise<boolean> {
  const res = await Route.updateOne(
    { _id: routeId, status: 'assigned', assignedDriverId: driverId },
    { status: 'in_progress', startedAt: new Date() }
  )
  if (res.modifiedCount) {
    await RouteStatusLog.create({
      routeId,
      fromStatus: 'assigned',
      toStatus: 'in_progress',
      actorType: 'driver',
    })
    return true
  }
  return false
}

export async function completeRoute(routeId: string, driverId: string): Promise<boolean> {
  const res = await Route.updateOne(
    { _id: routeId, assignedDriverId: driverId, status: 'in_progress' },
    { status: 'completed', completedAt: new Date() }
  )
  if (res.modifiedCount) {
    await RouteStatusLog.create({
      routeId,
      fromStatus: 'in_progress',
      toStatus: 'completed',
      actorType: 'driver',
    })
    return true
  }
  return false
}

export async function cancelRoutePreStart(routeId: string): Promise<boolean> {
  const route = await getRouteById(routeId)
  if (!route || route.status !== 'assigned') return false
  const res = await Route.updateOne(
    { _id: routeId, status: 'assigned' },
    {
      status: 'available',
      assignedDriverId: undefined,
      assignedAt: undefined,
    }
  )
  if (res.modifiedCount) {
    await RouteStatusLog.create({
      routeId,
      fromStatus: 'assigned',
      toStatus: 'available',
      actorType: 'system',
    })
    return true
  }
  return false
}

export async function updateStopStatus(
  stopId: string,
  status: 'completed' | 'failed',
  podS3Key?: string
): Promise<boolean> {
  const update: any = { status, completedAt: new Date() }
  if (podS3Key) update.podS3Key = podS3Key
  const res = await RouteStop.updateOne({ _id: stopId }, update)
  return res.modifiedCount > 0
}

export async function getRouteStopById(stopId: string): Promise<RouteStopRow | null> {
  const doc = await RouteStop.findById(stopId).lean()
  if (!doc) return null
  return toStopRow(doc)
}

export async function removeRouteStop(stopId: string): Promise<{ ok: boolean; orderId?: string; routeId?: string }> {
  const stop = await RouteStop.findById(stopId).lean()
  if (!stop) return { ok: false }
  const routeId = String(stop.routeId)
  const orderId = String(stop.orderId)
  const route = await Route.findById(routeId).lean()
  if (!route) return { ok: false }
  if ((route as any).status === 'completed') return { ok: false }
  await RouteStop.deleteOne({ _id: stopId })
  const { updateOrderStatus } = await import('./orders.repo')
  await updateOrderStatus(orderId, 'pending_pickup')
  const remaining = await RouteStop.find({ routeId }).sort({ sequence: 1 }).lean()
  for (let i = 0; i < remaining.length; i++) {
    await RouteStop.updateOne({ _id: remaining[i]._id }, { sequence: i + 1 })
  }
  const { Order } = await import('../models/Order')
  const { getRatesByStateAndZips, getDefaultRateCents } = await import('./zip_rate.repo')
  const orderIds = remaining.map((s: any) => s.orderId)
  const orders = orderIds.length > 0 ? await Order.find({ _id: { $in: orderIds } }).lean() : []
  const orderMap = new Map(orders.map((o: any) => [String(o._id), o]))
  const zips = [...new Set(remaining.map((s: any) => s.addressZip).filter(Boolean))]
  const zipRates = zips.length ? await getRatesByStateAndZips(String(route.stateId), zips) : new Map()
  const defaultRate = await getDefaultRateCents(String(route.stateId))
  let totalCharge = 0
  let totalPayout = 0
  for (const s of remaining as any[]) {
    const o = orderMap.get(String(s.orderId))
    if (o) {
      totalCharge += (o as any).rateTotalCents ?? 0
      totalPayout += zipRates.get(s.addressZip)?.driverPayoutCents ?? defaultRate.driverPayoutCents
    }
  }
  await Route.findByIdAndUpdate(routeId, {
    totalClientChargeCents: totalCharge,
    totalDriverPayoutCents: totalPayout,
    marginCents: totalCharge - totalPayout,
  })
  if (remaining.length === 0) {
    await Route.findByIdAndUpdate(routeId, { status: 'cancelled' })
  }
  return { ok: true, orderId, routeId }
}
