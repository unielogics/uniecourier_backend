import mongoose, { Schema } from 'mongoose'

/** Order/shipment status. pending_pickup = awaiting pickup; in_route = with driver; delivered; on_hold. */
export const ORDER_STATUSES = ['pending_pickup', 'pending', 'in_route', 'delivered', 'on_hold'] as const

const OrderSchema = new Schema(
  {
    stateId: { type: Schema.Types.ObjectId, ref: 'State', required: true },
    originHubId: { type: Schema.Types.ObjectId, ref: 'Hub' },
    /** Origin warehouse from WMS (WH-XXX + address). Used for label/ship-from when set. */
    originWarehouseCode: String,
    originWarehouseName: String,
    originWarehouseAddress: String,
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse' },
    externalOrderId: String,
    externalShipmentId: String,
    status: { type: String, required: true, default: 'pending_pickup' },
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
    // WMS / API integration: product and line info (from kiosk/API)
    sku: String,
    itemName: String,   // item title
    image: String,      // URL or data URL to product image
    description: String,
    quantityUnits: Number, // number of units
    // Weight/dimensions for rate and label
    weightLbs: Number,
    lengthIn: Number,
    widthIn: Number,
    heightIn: Number,
    // Rate (from rate-shop logic at creation)
    rateTotalCents: Number,
    // Billing / customer details
    billingName: String,
    billingCompany: String,
    billingEmail: String,
    billingPhone: String,
    /** WMS intermediary ID for billing reports and disputes */
    intermediaryId: String,
    /** Intermediary name for billing reports, disputes, and 4×6 label */
    intermediaryName: String,
    /** Payment status — only paid orders are eligible for route builder */
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid'],
      default: 'unpaid',
    },
  },
  { timestamps: true, collection: 'orders' }
)

OrderSchema.index({ stateId: 1 })
OrderSchema.index({ status: 1 })
OrderSchema.index({ addressZip: 1 })
OrderSchema.index({ warehouseId: 1 })
export const Order = mongoose.model('Order', OrderSchema)
