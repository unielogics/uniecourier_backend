import mongoose, { Schema } from 'mongoose'

const ZipRateTableSchema = new Schema(
  {
    stateId: { type: Schema.Types.ObjectId, ref: 'State', required: true },
    zip: { type: String, required: true },
    driverPayoutCents: { type: Number, required: true, default: 0 },
    clientChargeCents: { type: Number, required: true, default: 0 },
  },
  { timestamps: true, collection: 'zip_rate_tables' }
)

ZipRateTableSchema.index({ stateId: 1 })
ZipRateTableSchema.index({ stateId: 1, zip: 1 }, { unique: true })
export const ZipRateTable = mongoose.model('ZipRateTable', ZipRateTableSchema)
