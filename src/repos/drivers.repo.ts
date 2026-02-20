import { Driver } from '../models/Driver'
import { DriverZipCoverage } from '../models/DriverZipCoverage'

export interface DriverRow {
  id: string
  stateId: string
  userId: string | null
  name: string
  email: string | null
  phone: string | null
  addressLine1: string | null
  addressCity: string | null
  addressState: string | null
  addressZip: string | null
  maxMilesPerDay: number | null
  vehicleType: string | null
  vehicleMake: string | null
  vehicleModel: string | null
  vehicleDescription: string | null
  insurancePolicyNumber: string | null
  insuranceExpiry: Date | null
  licenseNumber: string | null
  licenseState: string | null
  licenseExpiry: Date | null
  active: boolean
  onHold: boolean
  createdAt: Date
  updatedAt: Date
}

export interface DriverZipRow {
  driverId: string
  zip: string
  lat: number | null
  lon: number | null
}

export async function findDriverById(id: string): Promise<DriverRow | null> {
  const doc = await Driver.findById(id).lean()
  if (!doc) return null
  const d = doc as any
  return {
    id: String(doc._id),
    stateId: String(doc.stateId),
    userId: doc.userId ? String(doc.userId) : null,
    name: doc.name,
    email: doc.email ?? null,
    phone: doc.phone ?? null,
    addressLine1: d.addressLine1 ?? null,
    addressCity: d.addressCity ?? null,
    addressState: d.addressState ?? null,
    addressZip: d.addressZip ?? null,
    maxMilesPerDay: d.maxMilesPerDay ?? null,
    vehicleType: doc.vehicleType ?? null,
    vehicleMake: d.vehicleMake ?? null,
    vehicleModel: d.vehicleModel ?? null,
    vehicleDescription: d.vehicleDescription ?? null,
    insurancePolicyNumber: d.insurancePolicyNumber ?? null,
    insuranceExpiry: d.insuranceExpiry ?? null,
    licenseNumber: d.licenseNumber ?? null,
    licenseState: d.licenseState ?? null,
    licenseExpiry: d.licenseExpiry ?? null,
    active: doc.active,
    onHold: (doc as any).onHold ?? false,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

export async function findDriverByUserId(userId: string): Promise<DriverRow | null> {
  const doc = await Driver.findOne({ userId }).lean()
  if (!doc) return null
  const d = doc as any
  return {
    id: String(doc._id),
    stateId: String(doc.stateId),
    userId: doc.userId ? String(doc.userId) : null,
    name: doc.name,
    email: doc.email ?? null,
    phone: doc.phone ?? null,
    addressLine1: d.addressLine1 ?? null,
    addressCity: d.addressCity ?? null,
    addressState: d.addressState ?? null,
    addressZip: d.addressZip ?? null,
    maxMilesPerDay: d.maxMilesPerDay ?? null,
    vehicleType: doc.vehicleType ?? null,
    vehicleMake: d.vehicleMake ?? null,
    vehicleModel: d.vehicleModel ?? null,
    vehicleDescription: d.vehicleDescription ?? null,
    insurancePolicyNumber: d.insurancePolicyNumber ?? null,
    insuranceExpiry: d.insuranceExpiry ?? null,
    licenseNumber: d.licenseNumber ?? null,
    licenseState: d.licenseState ?? null,
    licenseExpiry: d.licenseExpiry ?? null,
    active: doc.active,
    onHold: d.onHold ?? false,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

export async function updateDriverStatus(
  driverId: string,
  update: { active?: boolean; onHold?: boolean; applicationStatus?: 'pending_review' | 'approved' | 'rejected' }
): Promise<boolean> {
  const set: Record<string, unknown> = { ...update }
  if (update.active === true) set.applicationStatus = 'approved'
  const doc = await Driver.findByIdAndUpdate(driverId, { $set: set }).lean()
  return !!doc
}

export async function listDriversByState(
  stateId: string,
  activeOnly = true
): Promise<DriverRow[]> {
  const q: any = {}
  if (stateId && stateId !== 'all') q.stateId = stateId
  if (activeOnly) q.active = true
  const docs = await Driver.find(q).sort({ name: 1 }).lean()
  return docs.map((d: any) => ({
    id: String(d._id),
    stateId: String(d.stateId),
    userId: d.userId ? String(d.userId) : null,
    name: d.name,
    email: d.email ?? null,
    phone: d.phone ?? null,
    addressLine1: d.addressLine1 ?? null,
    addressCity: d.addressCity ?? null,
    addressState: d.addressState ?? null,
    addressZip: d.addressZip ?? null,
    maxMilesPerDay: d.maxMilesPerDay ?? null,
    vehicleType: d.vehicleType ?? null,
    vehicleMake: d.vehicleMake ?? null,
    vehicleModel: d.vehicleModel ?? null,
    vehicleDescription: d.vehicleDescription ?? null,
    insurancePolicyNumber: d.insurancePolicyNumber ?? null,
    insuranceExpiry: d.insuranceExpiry ?? null,
    licenseNumber: d.licenseNumber ?? null,
    licenseState: d.licenseState ?? null,
    licenseExpiry: d.licenseExpiry ?? null,
    active: d.active,
    onHold: d.onHold ?? false,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }))
}

export async function getDriverZips(driverId: string): Promise<DriverZipRow[]> {
  const docs = await DriverZipCoverage.find({ driverId }).lean()
  return docs.map((d) => ({
    driverId: String(d.driverId),
    zip: d.zip,
    lat: d.lat ?? null,
    lon: d.lon ?? null,
  }))
}

export async function createDriver(data: {
  stateId: string
  userId?: string
  name: string
  email?: string
  phone?: string
  vehicleType?: string
}): Promise<string> {
  const doc = await Driver.create({
    stateId: data.stateId,
    userId: data.userId,
    name: data.name,
    email: data.email,
    phone: data.phone,
    vehicleType: data.vehicleType,
  })
  return String(doc._id)
}

export async function setDriverZips(
  driverId: string,
  zips: { zip: string; lat?: number; lon?: number }[]
): Promise<void> {
  await DriverZipCoverage.deleteMany({ driverId })
  if (zips.length) {
    await DriverZipCoverage.insertMany(
      zips.map((z) => ({
        driverId,
        zip: z.zip,
        lat: z.lat,
        lon: z.lon,
      }))
    )
  }
}
