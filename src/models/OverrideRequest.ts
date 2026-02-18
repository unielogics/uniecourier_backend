import mongoose, { Schema } from 'mongoose'

const OverrideRequestSchema = new Schema(
  {
    stateId: { type: Schema.Types.ObjectId, ref: 'State', required: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver' },
    entityType: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    reason: String,
    status: {
      type: String,
      required: true,
      default: 'pending',
      enum: ['pending', 'approved', 'rejected'],
    },
  },
  { timestamps: true, collection: 'override_requests' }
)

OverrideRequestSchema.index({ stateId: 1 })
export const OverrideRequest = mongoose.model('OverrideRequest', OverrideRequestSchema)
