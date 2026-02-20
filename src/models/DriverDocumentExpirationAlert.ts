import mongoose, { Schema } from 'mongoose'

const DriverDocumentExpirationAlertSchema = new Schema(
  {
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
    stateId: { type: Schema.Types.ObjectId, ref: 'State', required: true },
    documentType: { type: String, required: true, enum: ['license', 'insurance'] },
    driverName: { type: String },
    expirationDate: { type: Date, required: true },
    alertedAt: { type: Date, default: Date.now },
    acknowledgedAt: Date,
    resolvedAt: Date,
    /** When resolved, notes about the renewal (e.g. new expiry date) */
    resolutionNotes: String,
  },
  { timestamps: true, collection: 'driver_document_expiration_alerts' }
)

DriverDocumentExpirationAlertSchema.index({ driverId: 1 })
DriverDocumentExpirationAlertSchema.index({ stateId: 1 })
DriverDocumentExpirationAlertSchema.index({ acknowledgedAt: 1 })
export const DriverDocumentExpirationAlert = mongoose.model(
  'DriverDocumentExpirationAlert',
  DriverDocumentExpirationAlertSchema
)
