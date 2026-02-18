import { OverrideRequest } from '../models/OverrideRequest'

export async function createOverrideRequest(data: {
  stateId: string
  requestedBy: string
  entityType: string
  entityId: string
  driverId?: string
  reason?: string
}): Promise<string> {
  const doc = await OverrideRequest.create({
    stateId: data.stateId,
    requestedBy: data.requestedBy,
    entityType: data.entityType,
    entityId: data.entityId,
    driverId: data.driverId,
    reason: data.reason,
    status: 'pending',
  })
  return String(doc._id)
}

export async function approveOverride(overrideId: string, approvedBy: string): Promise<boolean> {
  const res = await OverrideRequest.updateOne(
    { _id: overrideId, status: 'pending' },
    { status: 'approved', approvedBy }
  )
  return res.modifiedCount > 0
}

export async function findApprovedOverride(
  stateId: string,
  entityType: string,
  entityId: string,
  driverId: string
): Promise<boolean> {
  const count = await OverrideRequest.countDocuments({
    stateId,
    entityType,
    entityId,
    $or: [{ driverId }, { driverId: { $exists: false } }, { driverId: null }],
    status: 'approved',
  })
  return count > 0
}
