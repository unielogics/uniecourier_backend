import mongoose, { Schema } from 'mongoose'

const StateSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    timezone: { type: String, default: 'America/New_York' },
  },
  { timestamps: true, collection: 'states' }
)

export const State = mongoose.model('State', StateSchema)
