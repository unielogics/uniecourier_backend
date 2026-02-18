import mongoose from 'mongoose'
import dotenv from 'dotenv'

dotenv.config()

/**
 * MongoDB layout (same server / "UnieWMS connection"):
 * - One database is dedicated to UnieCourier; all data for this platform lives there
 *   (hubs, drivers, states, users, driver invites, routes, etc.).
 * - Other databases on the same server (e.g. uniewms) belong to other products;
 *   we only read from them when needed (e.g. warehouses for the Hubs page).
 */

const DEFAULT_SERVER_URI = 'mongodb://localhost:27017'

/** Base URI to the MongoDB server (no database name). Same server as UnieWMS. */
export function getMongoServerBaseUri(): string {
  const uri = process.env.MONGODB_URI || process.env.DATABASE_URL || `${DEFAULT_SERVER_URI}/uniewms`
  const base = uri.replace(/\/[^/]*$/, '')
  return base || DEFAULT_SERVER_URI
}

/**
 * Database name for all UnieCourier data. Configurable so it can match your
 * existing "UnieCourier" database (e.g. set UNIECOURIER_DB_NAME=UnieCourier).
 */
export const UNIECOURIER_DB_NAME = process.env.UNIECOURIER_DB_NAME || 'uniecourier'

/** Full URI for the UnieCourier database (single DB for this platform). */
export function getUnieCourierUri(): string {
  return `${getMongoServerBaseUri()}/${UNIECOURIER_DB_NAME}`
}

const mongoOptions = {
  maxPoolSize: 20,
  minPoolSize: 2,
  maxIdleTimeMS: 30000,
  serverSelectionTimeoutMS: 15000,
  socketTimeoutMS: 45000,
  retryWrites: true,
  w: 'majority' as const,
}

export async function connectDB(): Promise<void> {
  if (mongoose.connection.readyState === 1) return
  const uri = getUnieCourierUri()
  const masked = uri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')
  console.log(`🔗 UnieCourier connecting to MongoDB (server + DB "${UNIECOURIER_DB_NAME}"): ${masked}`)
  await mongoose.connect(uri, mongoOptions)
  console.log(`✅ UnieCourier MongoDB connected: database "${UNIECOURIER_DB_NAME}" (all platform data lives here)`)
}

export default mongoose
