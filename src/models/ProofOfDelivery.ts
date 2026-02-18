import mongoose, { Schema } from 'mongoose'

const ProofOfDeliverySchema = new Schema(
  {
    routeStopId: { type: Schema.Types.ObjectId, ref: 'RouteStop', required: true },
    s3Key: { type: String, required: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: 'proof_of_deliveries' }
)

ProofOfDeliverySchema.index({ routeStopId: 1 })
export const ProofOfDelivery = mongoose.model('ProofOfDelivery', ProofOfDeliverySchema)
