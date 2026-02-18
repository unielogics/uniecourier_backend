import mongoose, { Schema } from 'mongoose'

const CommentSchema = new Schema(
  {
    entityType: { type: String, required: true }, // 'route' | 'route_stop' | 'order' | 'driver'
    entityId: { type: Schema.Types.ObjectId, required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    authorName: { type: String },
    body: { type: String, required: true },
  },
  { timestamps: true, collection: 'comments' }
)

CommentSchema.index({ entityType: 1, entityId: 1 })
export const Comment = mongoose.model('Comment', CommentSchema)
