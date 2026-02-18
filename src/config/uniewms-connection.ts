import mongoose from 'mongoose'
import { getMongoServerBaseUri } from './database'

/**
 * UnieWMS database: warehouses are in database UNIEWMS_DB_NAME, collection "warehouses".
 * If UNIEWMS_MONGODB_URI is set, use it (allows a different server or full URI).
 * Otherwise use same server as UnieCourier and database UNIEWMS_DB_NAME.
 */
export const UNIEWMS_DB_NAME = process.env.UNIEWMS_DB_NAME || 'uniewms'

function getUnieWmsUri(): string {
  const explicit = process.env.UNIEWMS_MONGODB_URI || process.env.WMS_MONGODB_URI
  if (explicit && explicit.trim()) {
    const trimmed = explicit.trim()
    if (trimmed.includes('/')) return trimmed
    return `${getMongoServerBaseUri()}/${trimmed}`
  }
  return `${getMongoServerBaseUri()}/${UNIEWMS_DB_NAME}`
}

const mongoOptions = {
  maxPoolSize: 5,
  minPoolSize: 1,
  maxIdleTimeMS: 30000,
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  retryWrites: true,
  w: 'majority' as const,
}

let uniewmsConnection: mongoose.Connection | null = null

export async function getUnieWmsConnection(): Promise<mongoose.Connection> {
  if (uniewmsConnection && uniewmsConnection.readyState === 1) {
    return uniewmsConnection
  }
  const uri = getUnieWmsUri()
  const masked = uri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')
  console.log(`[uniewms] Connecting to warehouses DB: ${masked}`)
  uniewmsConnection = await mongoose.createConnection(uri, mongoOptions).asPromise()
  console.log(`[uniewms] Connected to database: ${uniewmsConnection.db?.namespace ?? UNIEWMS_DB_NAME}`)
  return uniewmsConnection
}

export interface WarehouseFromWms {
  _id: string
  id: string
  code?: string
  name?: string
  addressStreet?: string
  addressCity?: string
  addressState?: string
  addressZip?: string
}

const WAREHOUSES_PROJECTION = {
  code: 1,
  name: 1,
  'address.street': 1,
  'address.city': 1,
  'address.state': 1,
  'address.zipCode': 1,
  'shippingAddress.street': 1,
  'shippingAddress.city': 1,
  'shippingAddress.state': 1,
  'shippingAddress.zipCode': 1,
}

function mapWarehouseDoc(d: any): WarehouseFromWms {
  const id = String(d._id)
  const addr = d.address || d.shippingAddress || {}
  return {
    _id: id,
    id,
    code: d.code,
    name: d.name,
    addressStreet: d.address?.street ?? d.shippingAddress?.street,
    addressCity: d.address?.city ?? d.shippingAddress?.city,
    addressState: d.address?.state ?? d.shippingAddress?.state,
    addressZip: d.address?.zipCode ?? d.shippingAddress?.zipCode,
  }
}

/**
 * Normalize state to the 2-letter code used in uniewms warehouses (address.state / shippingAddress.state).
 * If the state was stored as "NJ - New Jersey", we use "NJ"; if already "NJ", use as-is.
 */
export function normalizeStateCodeForWarehouses(stateCode: string): string {
  const s = (stateCode ?? '').trim()
  if (!s) return ''
  const withDash = s.indexOf(' - ')
  const withEnDash = s.indexOf(' – ')
  const splitAt = withDash >= 0 ? withDash : withEnDash >= 0 ? withEnDash : -1
  if (splitAt >= 0) return s.slice(0, splitAt).trim()
  return s
}

/**
 * Read warehouses from the UnieWMS database (database UNIEWMS_DB_NAME, collection "warehouses").
 * Matches state by address.state or shippingAddress.state (case-insensitive).
 * State is normalized so "NJ - New Jersey" becomes "NJ" to match warehouse documents.
 */
export async function getWarehousesFromUnieWmsDb(stateCode: string): Promise<WarehouseFromWms[]> {
  const conn = await getUnieWmsConnection()
  const db = conn.db
  if (!db) throw new Error('UnieWMS connection has no database')
  const coll = db.collection('warehouses')

  const code = normalizeStateCodeForWarehouses(stateCode)
  const codeVariants = code === '' ? [] : [code, code.toUpperCase(), code.toLowerCase()].filter((c, i, a) => a.indexOf(c) === i)
  const stateFilter =
    codeVariants.length === 0
      ? {}
      : {
          $or: [
            { 'address.state': { $in: codeVariants } },
            { 'shippingAddress.state': { $in: codeVariants } },
          ],
        }

  const cursor = coll
    .find(stateFilter, { projection: WAREHOUSES_PROJECTION })
    .sort({ name: 1, code: 1 })
    .limit(500)
  const docs = await cursor.toArray()

  let result = docs.map((d: any) => mapWarehouseDoc(d))

  if (result.length === 0 && code !== '') {
    // Fallback: fetch all and filter in memory in case field format differs
    const allCursor = coll.find({}, { projection: WAREHOUSES_PROJECTION }).sort({ name: 1, code: 1 }).limit(500)
    const allDocs = await allCursor.toArray()
    const codeLower = code.toLowerCase()
    result = allDocs
      .filter((d: any) => {
        const s = (d.address?.state ?? d.shippingAddress?.state ?? '') as string
        return s.toLowerCase() === codeLower
      })
      .map((d: any) => mapWarehouseDoc(d))
  }

  return result
}
