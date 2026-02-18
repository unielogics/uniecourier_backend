import mongoose, { Schema } from 'mongoose'

// Minimum cost (e.g. $70 for car, $150 for truck) to use this vehicle type in a state
const VehicleMinCostSchema = new Schema(
  {
    stateId: { type: Schema.Types.ObjectId, ref: 'State', required: true },
    vehicleType: { type: String, required: true }, // 'car', 'van', 'box_truck'
    minCostCents: { type: Number, required: true }, // e.g. 7000 = $70
  },
  { timestamps: true, collection: 'vehicle_min_costs' }
)

VehicleMinCostSchema.index({ stateId: 1, vehicleType: 1 }, { unique: true })
export const VehicleMinCost = mongoose.model('VehicleMinCost', VehicleMinCostSchema)
