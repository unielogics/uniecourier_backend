import { Driver } from '../models/Driver'
import { DriverDocumentExpirationAlert } from '../models/DriverDocumentExpirationAlert'

/** Days before expiration to start alerting */
const ALERT_DAYS_BEFORE = parseInt(process.env.DRIVER_DOC_ALERT_DAYS || '30', 10)

export interface DriverDocExpirationAlertRow {
  id: string
  driverId: string
  stateId: string
  documentType: 'license' | 'insurance'
  driverName: string | null
  expirationDate: string
  alertedAt: string
  acknowledgedAt: string | null
  resolvedAt: string | null
  resolutionNotes: string | null
}

export async function flagDriverDocumentExpirations(): Promise<number> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() + ALERT_DAYS_BEFORE)
  const drivers = await Driver.find({
    $or: [
      { licenseExpiry: { $lte: cutoff, $ne: null } },
      { insuranceExpiry: { $lte: cutoff, $ne: null } },
    ],
    active: true,
  }).lean()

  let count = 0
  for (const d of drivers) {
    const driverId = d._id
    const stateId = d.stateId
    const driverName = d.name

    if (d.licenseExpiry) {
      const existing = await DriverDocumentExpirationAlert.findOne({
        driverId,
        documentType: 'license',
        resolvedAt: null,
      })
      if (!existing) {
        await DriverDocumentExpirationAlert.create({
          driverId,
          stateId,
          documentType: 'license',
          driverName,
          expirationDate: d.licenseExpiry,
        })
        count++
      }
    }
    if (d.insuranceExpiry) {
      const existing = await DriverDocumentExpirationAlert.findOne({
        driverId,
        documentType: 'insurance',
        resolvedAt: null,
      })
      if (!existing) {
        await DriverDocumentExpirationAlert.create({
          driverId,
          stateId,
          documentType: 'insurance',
          driverName,
          expirationDate: d.insuranceExpiry,
        })
        count++
      }
    }
  }
  return count
}

export async function getDriverDocumentExpirationAlertsForState(
  stateId: string,
  includeResolved = false
): Promise<DriverDocExpirationAlertRow[]> {
  const match: Record<string, unknown> = { stateId }
  if (!includeResolved) match.resolvedAt = null
  const docs = await DriverDocumentExpirationAlert.find(match)
    .sort({ expirationDate: 1 })
    .lean()

  return docs.map((a: any) => ({
    id: String(a._id),
    driverId: String(a.driverId),
    stateId: String(a.stateId),
    documentType: a.documentType,
    driverName: a.driverName ?? null,
    expirationDate: String(a.expirationDate),
    alertedAt: String(a.alertedAt),
    acknowledgedAt: a.acknowledgedAt ? String(a.acknowledgedAt) : null,
    resolvedAt: a.resolvedAt ? String(a.resolvedAt) : null,
    resolutionNotes: a.resolutionNotes ?? null,
  }))
}
