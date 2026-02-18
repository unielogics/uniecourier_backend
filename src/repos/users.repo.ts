import { User } from '../models/User'
import type { Role } from '../types'

export interface UserRow {
  id: string
  email: string
  passwordHash: string
  name: string | null
  imageUrl: string | null
  role: Role
  stateId: string | null
  warehouseId: string | null
  active: boolean
  createdAt: Date
  updatedAt: Date
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const doc = await User.findOne({
    email: email.toLowerCase(),
    active: true,
  }).lean()
  if (!doc) return null
  const d = doc as any
  return {
    id: String(doc._id),
    email: doc.email,
    passwordHash: doc.passwordHash,
    name: d.name ?? null,
    imageUrl: d.imageUrl ?? null,
    role: doc.role as Role,
    stateId: doc.stateId ? String(doc.stateId) : null,
    warehouseId: doc.warehouseId ? String(doc.warehouseId) : null,
    active: doc.active,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const doc = await User.findById(id).lean()
  if (!doc) return null
  const d = doc as any
  return {
    id: String(doc._id),
    email: doc.email,
    passwordHash: doc.passwordHash,
    name: d.name ?? null,
    imageUrl: d.imageUrl ?? null,
    role: doc.role as Role,
    stateId: doc.stateId ? String(doc.stateId) : null,
    warehouseId: doc.warehouseId ? String(doc.warehouseId) : null,
    active: doc.active,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

export async function createUser(data: {
  email: string
  passwordHash: string
  name?: string
  imageUrl?: string
  role: Role
  stateId?: string
  warehouseId?: string
}): Promise<string> {
  const doc = await User.create({
    email: data.email.toLowerCase(),
    passwordHash: data.passwordHash,
    name: data.name || undefined,
    imageUrl: data.imageUrl || undefined,
    role: data.role,
    stateId: data.stateId || undefined,
    warehouseId: data.warehouseId || undefined,
  })
  return String(doc._id)
}
