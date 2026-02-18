import { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { findUserByEmail } from '../repos/users.repo'
import { findDriverByUserId } from '../repos/drivers.repo'
import { signToken } from '../middleware/auth'
import type { Role } from '../types'

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: { email: string; password: string }
  }>('/api/v1/auth/login', async (request, reply) => {
    const { email, password } = request.body || {}
    if (!email || !password) {
      return reply.code(400).send({ error: 'Email and password required' })
    }
    const user = await findUserByEmail(email)
    if (!user) {
      return reply.code(401).send({ error: 'Invalid credentials' })
    }
    const ok = await bcrypt.compare(password, user.passwordHash)
    if (!ok) {
      return reply.code(401).send({ error: 'Invalid credentials' })
    }
    let driverId: string | undefined
    if (user.role === 'driver') {
      const driver = await findDriverByUserId(user.id)
      driverId = driver?.id
    }
    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role as Role,
      stateId: user.stateId || undefined,
      warehouseId: user.warehouseId || undefined,
      driverId,
    })
    return reply.send({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        imageUrl: user.imageUrl,
        role: user.role,
        stateId: user.stateId,
        warehouseId: user.warehouseId,
        driverId,
      },
    })
  })
}
