import mongoose, { Schema } from 'mongoose'

// Same tier settings for all zones (global per state). Market size/weight bands: Tier 1, 2, 3, 4...
const WeightSizeTierSchema = new Schema(
  {
    stateId: { type: Schema.Types.ObjectId, ref: 'State', required: true },
    tier: { type: Number, required: true }, // 1, 2, 3, 4
    label: { type: String }, // e.g. "Tier 1", "Tier 2"
    minWeightOz: { type: Number }, // min weight in oz
    maxWeightOz: { type: Number },
    minLengthIn: { type: Number },
    maxLengthIn: { type: Number },
    minWidthIn: { type: Number },
    maxWidthIn: { type: Number },
    minHeightIn: { type: Number },
    maxHeightIn: { type: Number },
  },
  { timestamps: true, collection: 'weight_size_tiers' }
)

WeightSizeTierSchema.index({ stateId: 1, tier: 1 }, { unique: true })
export const WeightSizeTier = mongoose.model('WeightSizeTier', WeightSizeTierSchema)
