import mongoose, { Schema } from 'mongoose'

const IssueReportSchema = new Schema(
  {
    entityType: { type: String, required: true }, // 'route' | 'route_stop' | 'order' | 'driver'
    entityId: { type: Schema.Types.ObjectId, required: true },
    stateId: { type: Schema.Types.ObjectId, ref: 'State' },
    type: { type: String, required: true }, // 'delivery_failed' | 'damage' | 'delay' | 'wrong_address' | 'other'
    summary: { type: String, required: true },
    description: String,
    reportedById: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, required: true, default: 'open', enum: ['open', 'in_progress', 'resolved', 'closed'] },
    resolvedAt: Date,
    resolvedById: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'issue_reports' }
)

IssueReportSchema.index({ entityType: 1, entityId: 1 })
IssueReportSchema.index({ stateId: 1, status: 1 })
export const IssueReport = mongoose.model('IssueReport', IssueReportSchema)
