import mongoose, { Schema } from 'mongoose'

const RouteStatusLogSchema = new Schema(
  {
    routeId: { type: Schema.Types.ObjectId, ref: 'Route', required: true },
    fromStatus: String,
    toStatus: { type: String, required: true },
    actorId: Schema.Types.ObjectId,
    actorType: String,
  },
  { timestamps: true, collection: 'route_status_logs' }
)

RouteStatusLogSchema.index({ routeId: 1 })
export const RouteStatusLog = mongoose.model('RouteStatusLog', RouteStatusLogSchema)
