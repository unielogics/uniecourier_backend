import mongoose, { Schema } from 'mongoose'

const RouteStopSchema = new Schema(
  {
    routeId: { type: Schema.Types.ObjectId, ref: 'Route', required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    sequence: { type: Number, required: true },
    addressLine1: { type: String, required: true },
    addressCity: String,
    addressState: String,
    addressZip: { type: String, required: true },
    podS3Key: String,
    status: {
      type: String,
      required: true,
      default: 'pending',
      enum: ['pending', 'completed', 'failed'],
    },
    completedAt: Date,
  },
  { timestamps: true, collection: 'route_stops' }
)

RouteStopSchema.index({ routeId: 1 })
RouteStopSchema.index({ orderId: 1 })
export const RouteStop = mongoose.model('RouteStop', RouteStopSchema)
