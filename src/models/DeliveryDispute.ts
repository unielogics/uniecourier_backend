import mongoose, { Schema } from 'mongoose'

/**
 * Dispute on a UnieCourier delivery order. Warehouse or admin raises; admin resolves.
 * Supports refunds and adjustments.
 */
export type DeliveryDisputeStatus = 'open' | 'approved' | 'denied' | 'adjusted'

export type DeliveryDisputeRequestType = 'refund' | 'adjustment' | 'credit'

export const DELIVERY_DISPUTE_REASON_CATEGORIES = [
  'payment_amount_incorrect',
  'payment_not_received',
  'service_not_as_agreed',
  'damaged_or_late_delivery',
  'documentation_issue',
  'other',
] as const
export type DeliveryDisputeReasonCategory = (typeof DELIVERY_DISPUTE_REASON_CATEGORIES)[number]

export interface IDeliveryDispute extends mongoose.Document {
  orderId: mongoose.Types.ObjectId
  stateId: mongoose.Types.ObjectId
  raisedBy: 'warehouse' | 'admin'
  requestType: DeliveryDisputeRequestType
  reasonCategory?: DeliveryDisputeReasonCategory
  reason?: string
  requestedAmountCents?: number
  status: DeliveryDisputeStatus
  resolvedAmountCents?: number
  resolvedAt?: Date
  resolvedBy?: string
  resolutionNotes?: string
  originWarehouseCode?: string
  intermediaryId?: string
  createdAt?: Date
  updatedAt?: Date
}

const DeliveryDisputeSchema = new Schema<IDeliveryDispute>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    stateId: { type: Schema.Types.ObjectId, ref: 'State', required: true, index: true },
    raisedBy: { type: String, enum: ['warehouse', 'admin'], required: true, index: true },
    requestType: {
      type: String,
      enum: ['refund', 'adjustment', 'credit'],
      required: true,
      index: true,
    },
    reasonCategory: {
      type: String,
      enum: DELIVERY_DISPUTE_REASON_CATEGORIES,
      default: 'other',
      index: true,
    },
    reason: { type: String, default: '' },
    requestedAmountCents: { type: Number },
    status: {
      type: String,
      enum: ['open', 'approved', 'denied', 'adjusted'],
      default: 'open',
      index: true,
    },
    resolvedAmountCents: { type: Number },
    resolvedAt: { type: Date },
    resolvedBy: { type: String },
    resolutionNotes: { type: String },
    originWarehouseCode: { type: String, index: true },
    intermediaryId: { type: String, index: true },
  },
  { timestamps: true, collection: 'delivery_disputes' }
)

DeliveryDisputeSchema.index({ stateId: 1, status: 1 })
DeliveryDisputeSchema.index({ originWarehouseCode: 1, status: 1 })
DeliveryDisputeSchema.index({ orderId: 1 })

export const DeliveryDispute = mongoose.model<IDeliveryDispute>(
  'DeliveryDispute',
  DeliveryDisputeSchema
)
