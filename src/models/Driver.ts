import mongoose, { Schema } from 'mongoose'

const DriverSchema = new Schema(
  {
    stateId: { type: Schema.Types.ObjectId, ref: 'State', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, required: true },
    email: String,
    phone: String,
    addressLine1: String,
    addressCity: String,
    addressState: String,
    addressZip: String,
    maxMilesPerDay: Number,
    vehicleType: String,
    vehicleMake: String,
    vehicleModel: String,
    vehicleDescription: String,
    insurancePolicyNumber: String,
    insuranceExpiry: Date,
    licenseNumber: String,
    licenseState: String,
    licenseExpiry: Date,
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'drivers' }
)

DriverSchema.index({ stateId: 1 })
DriverSchema.index({ userId: 1 }, { sparse: true })
export const Driver = mongoose.model('Driver', DriverSchema)
