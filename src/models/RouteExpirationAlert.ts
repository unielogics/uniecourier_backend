import mongoose, { Schema } from 'mongoose'

const RouteExpirationAlertSchema = new Schema(
  {
    routeId: { type: Schema.Types.ObjectId, ref: 'Route', required: true },
    stateId: { type: Schema.Types.ObjectId, ref: 'State', required: true },
    availableAt: { type: Date, required: true },
    alertedAt: { type: Date, default: Date.now },
    acknowledgedAt: Date,
  },
  { timestamps: true, collection: 'route_expiration_alerts' }
)

RouteExpirationAlertSchema.index({ routeId: 1 })
RouteExpirationAlertSchema.index({ stateId: 1 })
export const RouteExpirationAlert = mongoose.model('RouteExpirationAlert', RouteExpirationAlertSchema)
