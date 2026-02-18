import mongoose, { Schema } from 'mongoose'

const BrokerSchema = new Schema(
  {
    name: { type: String, required: true },
  },
  { timestamps: true, collection: 'brokers' }
)

export const Broker = mongoose.model('Broker', BrokerSchema)
