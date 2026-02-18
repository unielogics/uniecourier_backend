import mongoose, { Schema } from 'mongoose'

const DriverZipCoverageSchema = new Schema(
  {
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
    zip: { type: String, required: true },
    lat: Number,
    lon: Number,
  },
  { timestamps: true, collection: 'driver_zip_coverages' }
)

DriverZipCoverageSchema.index({ driverId: 1 })
DriverZipCoverageSchema.index({ zip: 1 })
DriverZipCoverageSchema.index({ driverId: 1, zip: 1 }, { unique: true })
export const DriverZipCoverage = mongoose.model('DriverZipCoverage', DriverZipCoverageSchema)
