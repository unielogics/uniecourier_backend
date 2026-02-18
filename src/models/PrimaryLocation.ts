import mongoose, { Schema } from 'mongoose'

const PrimaryLocationSchema = new Schema(
  {
    stateId: { type: Schema.Types.ObjectId, ref: 'State', required: true },
    warehouseId: { type: String, required: true },
    code: String,
    name: String,
    addressStreet: String,
    addressCity: String,
    addressState: String,
    addressZip: String,
  },
  { timestamps: true, collection: 'primary_locations' }
)

PrimaryLocationSchema.index({ stateId: 1 })
PrimaryLocationSchema.index({ stateId: 1, warehouseId: 1 }, { unique: true })
export const PrimaryLocation = mongoose.model('PrimaryLocation', PrimaryLocationSchema)
