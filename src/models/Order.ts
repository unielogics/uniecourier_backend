import mongoose, { Schema } from 'mongoose'

const OrderSchema = new Schema(
  {
    stateId: { type: Schema.Types.ObjectId, ref: 'State', required: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse' },
    externalOrderId: String,
    externalShipmentId: String,
    status: { type: String, required: true, default: 'pending' },
    addressName: String,
    addressCompany: String,
    addressLine1: { type: String, required: true },
    addressLine2: String,
    addressCity: { type: String, required: true },
    addressState: { type: String, required: true },
    addressZip: { type: String, required: true },
    addressCountry: { type: String, default: 'US' },
    deadlineAt: Date,
    itemType: { type: String, default: 'parcel' },
  },
  { timestamps: true, collection: 'orders' }
)

OrderSchema.index({ stateId: 1 })
OrderSchema.index({ status: 1 })
OrderSchema.index({ addressZip: 1 })
OrderSchema.index({ warehouseId: 1 })
export const Order = mongoose.model('Order', OrderSchema)
