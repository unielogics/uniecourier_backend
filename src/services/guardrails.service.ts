import { getRouteStops } from '../repos/routes.repo'
import { getDriverZips } from '../repos/drivers.repo'
import { ZipCentroid } from '../models/ZipCentroid'

const RADIUS_MILES = 25

/** Returns true if driver is allowed to be assigned to this route (ZIP coverage or 25 mi). */
export async function driverCanTakeRoute(driverId: string, routeId: string): Promise<boolean> {
  const [stops, zips] = await Promise.all([
    getRouteStops(routeId),
    getDriverZips(driverId),
  ])
  const routeZips = new Set(stops.map((s) => s.address_zip))
  const driverZipSet = new Set(zips.map((z) => z.zip))
  for (const z of routeZips) {
    if (driverZipSet.has(z)) return true
  }
  const driverWithCoords = zips.filter(
    (z): z is { driverId: string; zip: string; lat: number; lon: number } =>
      z.lat != null && z.lon != null
  )
  if (driverWithCoords.length === 0) return false
  try {
    const coords = await ZipCentroid.find({ zip: { $in: [...routeZips] } }).lean()
    if (!coords.length) return false
    const sum = coords.reduce(
      (a, b) => ({ lat: a.lat + b.lat, lon: a.lon + b.lon }),
      { lat: 0, lon: 0 }
    )
    const routeLat = sum.lat / coords.length
    const routeLon = sum.lon / coords.length
    for (const d of driverWithCoords) {
      if (haversineMiles(Number(d.lat), Number(d.lon), routeLat, routeLon) <= RADIUS_MILES)
        return true
    }
  } catch {
    // ignore
  }
  return false
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
