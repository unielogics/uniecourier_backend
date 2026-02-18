import { State } from '../models/State'

export interface StateRow {
  id: string
  code: string
  name: string
  timezone: string
  createdAt: Date
  updatedAt: Date
}

export async function listStates(): Promise<StateRow[]> {
  const docs = await State.find().sort({ code: 1 }).lean()
  return docs.map((d) => ({
    id: String(d._id),
    code: d.code,
    name: d.name,
    timezone: d.timezone,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }))
}

export async function findStateById(id: string): Promise<StateRow | null> {
  const doc = await State.findById(id).lean()
  if (!doc) return null
  return {
    id: String(doc._id),
    code: doc.code,
    name: doc.name,
    timezone: doc.timezone,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

export async function findStateByCode(code: string): Promise<StateRow | null> {
  const doc = await State.findOne({ code: code.toUpperCase() }).lean()
  if (!doc) return null
  return {
    id: String(doc._id),
    code: doc.code,
    name: doc.name,
    timezone: doc.timezone,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

export async function createState(data: {
  code: string
  name: string
  timezone?: string
}): Promise<string> {
  const doc = await State.create({
    code: data.code.toUpperCase(),
    name: data.name,
    timezone: data.timezone || 'America/New_York',
  })
  return String(doc._id)
}
