import mongoose, { Schema } from 'mongoose'

const ItemTypeSurchargeSchema = new Schema(
  {
    stateId: { type: Schema.Types.ObjectId, ref: 'State', required: true },
    zipCode: { type: String, default: '' }, // '' = state-level default; otherwise per-zip in service area
    itemType: { type: String, required: true }, // e.g. 'parcel', 'freight', 'bulk', 'hazmat'
    label: { type: String, required: true },
    costDollars: { type: Number }, // our cost (base) in dollars; missing = not configured → needs attention. Decimals allowed.
    type: { type: String, required: true, enum: ['flat', 'percent'] },
    value: { type: Number, required: true, default: 0 }, // surcharge: flat = dollars, percent = e.g. 15 = 15%. Decimals allowed.
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'item_type_surcharges' }
)

ItemTypeSurchargeSchema.index({ stateId: 1 })
ItemTypeSurchargeSchema.index({ stateId: 1, zipCode: 1, itemType: 1 }, { unique: true })
export const ItemTypeSurcharge = mongoose.model('ItemTypeSurcharge', ItemTypeSurchargeSchema)
