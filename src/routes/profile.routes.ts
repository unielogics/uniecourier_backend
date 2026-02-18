import { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth'
import { findUserById } from '../repos/users.repo'
import { User } from '../models/User'

export async function registerProfileRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (instance) => {
    instance.addHook('preHandler', authMiddleware)

    instance.get('/api/v1/me', async (request: AuthenticatedRequest, reply) => {
      const userId = request.userId
      if (!userId) return reply.code(401).send({ error: 'Not authenticated' })
      const user = await findUserById(userId)
      if (!user) return reply.code(404).send({ error: 'User not found' })
      return reply.send({
        id: user.id,
        email: user.email,
        name: user.name,
        imageUrl: user.imageUrl,
        role: user.role,
        stateId: user.stateId,
        warehouseId: user.warehouseId,
      })
    })

    instance.patch<{
      Body: { name?: string; imageUrl?: string; currentPassword?: string; newPassword?: string }
    }>('/api/v1/me', async (request: AuthenticatedRequest, reply) => {
      const userId = request.userId
      if (!userId) return reply.code(401).send({ error: 'Not authenticated' })
      const body = request.body as any
      const doc = await User.findById(userId)
      if (!doc) return reply.code(404).send({ error: 'User not found' })

      if (body.name !== undefined) doc.name = body.name?.trim() || undefined
      if (body.imageUrl !== undefined) doc.imageUrl = body.imageUrl?.trim() || undefined

      if (body.newPassword) {
        if (!body.currentPassword) {
          return reply.code(400).send({ error: 'Current password required to set a new password' })
        }
        const ok = await bcrypt.compare(body.currentPassword, doc.passwordHash)
        if (!ok) return reply.code(400).send({ error: 'Current password is incorrect' })
        if (body.newPassword.length < 6) {
          return reply.code(400).send({ error: 'New password must be at least 6 characters' })
        }
        doc.passwordHash = await bcrypt.hash(body.newPassword, 10)
      }

      await doc.save()
      const user = await findUserById(userId)
      return reply.send({
        id: user!.id,
        email: user!.email,
        name: user!.name,
        imageUrl: user!.imageUrl,
        role: user!.role,
        stateId: user!.stateId,
        warehouseId: user!.warehouseId,
      })
    })
  })
}
