import mongoose, { Schema } from 'mongoose'
import type { Role } from '../types'

const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    name: { type: String },
    imageUrl: { type: String },
    role: {
      type: String,
      required: true,
      enum: ['admin', 'manager', 'dispatcher', 'warehouse', 'driver'] as Role[],
    },
    stateId: { type: Schema.Types.ObjectId, ref: 'State' },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'users' }
)

UserSchema.index({ stateId: 1 })
UserSchema.index({ role: 1 })
export const User = mongoose.model('User', UserSchema)
