import mongoose, { Schema } from 'mongoose'

const DriverInviteSchema = new Schema(
  {
    stateId: { type: Schema.Types.ObjectId, ref: 'State', required: true },
    email: { type: String }, // optional when generating link-only invite
    token: { type: String, required: true, unique: true },
    status: {
      type: String,
      required: true,
      default: 'pending',
      enum: ['pending', 'accepted', 'expired', 'cancelled'],
    },
    expiresAt: { type: Date, required: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    acceptedAt: Date,
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver' },
  },
  { timestamps: true, collection: 'driver_invites' }
)

DriverInviteSchema.index({ stateId: 1 })
DriverInviteSchema.index({ token: 1 })
DriverInviteSchema.index({ email: 1, stateId: 1 })
export const DriverInvite = mongoose.model('DriverInvite', DriverInviteSchema)
