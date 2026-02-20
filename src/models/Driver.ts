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
    licenseImageFrontKey: String,
    licenseImageBackKey: String,
    driverPhotoKey: String,
    /** pending_review = applicant, not yet approved; approved = can take routes; rejected = application denied */
    applicationStatus: { type: String, enum: ['pending_review', 'approved', 'rejected'], default: 'pending_review' },
    active: { type: Boolean, default: false },
    /** When true, driver is temporarily paused (e.g. not taking new routes). Distinct from active=false (disabled). */
    onHold: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'drivers' }
)

DriverSchema.index({ stateId: 1 })
DriverSchema.index({ userId: 1 }, { sparse: true })
export const Driver = mongoose.model('Driver', DriverSchema)
