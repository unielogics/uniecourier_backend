import mongoose, { Schema } from 'mongoose'

const HubSchema = new Schema(
  {
    stateId: { type: Schema.Types.ObjectId, ref: 'State' },
    name: { type: String, required: true },
    addressLine1: { type: String, required: true },
    addressLine2: String,
    addressCity: { type: String, required: true },
    addressState: { type: String, required: true },
    addressZip: { type: String, required: true },
    contactName: String,
    contactPhone: String,
    operatingHours: String, // e.g. "Mon–Fri 8am–6pm"
    active: { type: Boolean, default: true },
    lat: Number,
    lon: Number,
  },
  { timestamps: true, collection: 'hubs' }
)

HubSchema.index({ stateId: 1 })
export const Hub = mongoose.model('Hub', HubSchema)
