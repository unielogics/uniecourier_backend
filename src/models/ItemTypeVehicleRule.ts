import mongoose, { Schema } from 'mongoose'

// Global rules: parcel → car, van for bulk/hazmat/freight
const ItemTypeVehicleRuleSchema = new Schema(
  {
    stateId: { type: Schema.Types.ObjectId, ref: 'State', required: true },
    itemType: { type: String, required: true, enum: ['parcel', 'freight', 'bulk', 'hazmat'] },
    vehicleType: { type: String, required: true }, // e.g. 'car', 'van', 'box_truck'
  },
  { timestamps: true, collection: 'item_type_vehicle_rules' }
)

ItemTypeVehicleRuleSchema.index({ stateId: 1, itemType: 1 }, { unique: true })
export const ItemTypeVehicleRule = mongoose.model('ItemTypeVehicleRule', ItemTypeVehicleRuleSchema)
