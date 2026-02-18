import mongoose, { Schema } from 'mongoose'

// Same tier settings for all zones (global per state). Market size/weight bands: Tier 1, 2, 3, 4...
const WeightSizeTierSchema = new Schema(
  {
    stateId: { type: Schema.Types.ObjectId, ref: 'State', required: true },
    tier: { type: Number, required: true }, // 1, 2, 3, 4
    label: { type: String }, // e.g. "Tier 1", "Tier 2"
    minWeightOz: { type: Number }, // legacy, prefer minWeightLbs
    maxWeightOz: { type: Number },
    minWeightLbs: { type: Number }, // min weight in lbs (decimals allowed); empty = 0
    maxWeightLbs: { type: Number },
    minLengthIn: { type: Number },
    maxLengthIn: { type: Number },
    minWidthIn: { type: Number },
    maxWidthIn: { type: Number },
    minHeightIn: { type: Number },
    maxHeightIn: { type: Number },
    plusCents: { type: Number }, // add this many cents to base cost when item falls in this tier
  },
  { timestamps: true, collection: 'weight_size_tiers' }
)

WeightSizeTierSchema.index({ stateId: 1, tier: 1 }, { unique: true })
export const WeightSizeTier = mongoose.model('WeightSizeTier', WeightSizeTierSchema)
