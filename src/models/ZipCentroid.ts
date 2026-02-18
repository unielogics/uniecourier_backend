import mongoose, { Schema } from 'mongoose'

const ZipCentroidSchema = new Schema(
  {
    zip: { type: String, required: true, unique: true },
    lat: { type: Number, required: true },
    lon: { type: Number, required: true },
  },
  { timestamps: false, collection: 'zip_centroids' }
)

ZipCentroidSchema.index({ lat: 1, lon: 1 })
export const ZipCentroid = mongoose.model('ZipCentroid', ZipCentroidSchema)
