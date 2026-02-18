import { ZipRateTable } from '../models/ZipRateTable'

export interface ZipRateRow {
  id: string
  stateId: string
  zip: string
  driverPayoutCents: number
  clientChargeCents: number
}

export async function getRatesByStateAndZips(
  stateId: string,
  zips: string[]
): Promise<Map<string, { driverPayoutCents: number; clientChargeCents: number }>> {
  if (zips.length === 0) return new Map()
  const docs = await ZipRateTable.find({ stateId, zip: { $in: zips } }).lean()
  const map = new Map<string, { driverPayoutCents: number; clientChargeCents: number }>()
  for (const d of docs) {
    map.set(d.zip, {
      driverPayoutCents: d.driverPayoutCents,
      clientChargeCents: d.clientChargeCents,
    })
  }
  return map
}

export async function getDefaultRateCents(stateId: string): Promise<{
  driverPayoutCents: number
  clientChargeCents: number
}> {
  const doc = await ZipRateTable.findOne({ stateId }).lean()
  if (doc)
    return {
      driverPayoutCents: doc.driverPayoutCents,
      clientChargeCents: doc.clientChargeCents,
    }
  return { driverPayoutCents: 0, clientChargeCents: 0 }
}

export async function upsertZipRate(data: {
  stateId: string
  zip: string
  driverPayoutCents: number
  clientChargeCents: number
}): Promise<void> {
  await ZipRateTable.findOneAndUpdate(
    { stateId: data.stateId, zip: data.zip },
    {
      driverPayoutCents: data.driverPayoutCents,
      clientChargeCents: data.clientChargeCents,
    },
    { upsert: true }
  )
}
