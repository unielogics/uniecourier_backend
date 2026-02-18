import mongoose, { Schema } from 'mongoose'

const WarehouseSchema = new Schema(
  {
    stateId: { type: Schema.Types.ObjectId, ref: 'State', required: true },
    externalId: String,
    code: String,
    name: String,
    addressStreet: String,
    addressCity: String,
    addressState: String,
    addressZip: String,
    addressCountry: { type: String, default: 'US' },
    lat: Number,
    lon: Number,
  },
  { timestamps: true, collection: 'warehouses' }
)

WarehouseSchema.index({ stateId: 1 })
export const Warehouse = mongoose.model('Warehouse', WarehouseSchema)
