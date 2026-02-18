import mongoose, { Schema } from 'mongoose'

const ServiceAreaZipSchema = new Schema(
  {
    stateId: { type: Schema.Types.ObjectId, ref: 'State', required: true },
    zipCode: { type: String, required: true },
    label: { type: String }, // optional display name e.g. "North NJ"
  },
  { timestamps: true, collection: 'service_area_zips' }
)

ServiceAreaZipSchema.index({ stateId: 1, zipCode: 1 }, { unique: true })
ServiceAreaZipSchema.index({ stateId: 1 })
ServiceAreaZipSchema.index({ zipCode: 1 }) // for rate-shop: resolve state from ZIP
export const ServiceAreaZip = mongoose.model('ServiceAreaZip', ServiceAreaZipSchema)
