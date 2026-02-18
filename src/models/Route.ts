import mongoose, { Schema } from 'mongoose'
import type { RouteStatus } from '../types'

const RouteSchema = new Schema(
  {
    stateId: { type: Schema.Types.ObjectId, ref: 'State', required: true },
    status: {
      type: String,
      required: true,
      default: 'available',
      enum: ['available', 'assigned', 'in_progress', 'completed', 'cancelled'] as RouteStatus[],
    },
    vehicleFilter: String,
    totalDriverPayoutCents: { type: Number, required: true, default: 0 },
    totalClientChargeCents: { type: Number, required: true, default: 0 },
    marginCents: { type: Number, required: true, default: 0 },
    assignedDriverId: { type: Schema.Types.ObjectId, ref: 'Driver' },
    availableAt: { type: Date, default: Date.now },
    assignedAt: Date,
    startedAt: Date,
    completedAt: Date,
  },
  { timestamps: true, collection: 'routes' }
)

RouteSchema.index({ stateId: 1 })
RouteSchema.index({ status: 1 })
RouteSchema.index({ availableAt: 1 })
RouteSchema.index({ assignedDriverId: 1 })
export const Route = mongoose.model('Route', RouteSchema)
