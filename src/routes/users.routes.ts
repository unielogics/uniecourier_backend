import { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { authMiddleware, requireRole, requireStateScope, type AuthenticatedRequest } from '../middleware/auth'
import { User } from '../models/User'
import { Driver } from '../models/Driver'

export async function registerUsersRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (instance) => {
    instance.addHook('preHandler', authMiddleware)
    instance.addHook('preHandler', requireRole('admin', 'manager'))

    instance.post<{
      Body: { email: string; password: string; name?: string; role: string; stateId?: string; warehouseId?: string }
    }>('/api/v1/users', async (request: AuthenticatedRequest, reply) => {
      if (request.role !== 'admin') {
        return reply.code(403).send({ error: 'Admin only' })
      }
      const body = request.body as any
      if (!body?.email?.trim() || !body?.password) {
        return reply.code(400).send({ error: 'Email and password required' })
      }
      const role = body.role as string
      const validRoles = ['admin', 'manager', 'dispatcher', 'warehouse', 'driver']
      if (!role || !validRoles.includes(role)) {
        return reply.code(400).send({ error: 'Valid role required: admin, manager, dispatcher, warehouse, driver' })
      }
      if (role !== 'admin' && !body.stateId) {
        return reply.code(400).send({ error: 'State is required for non-admin users' })
      }
      const existing = await User.findOne({ email: body.email.trim().toLowerCase() })
      if (existing) return reply.code(400).send({ error: 'A user with this email already exists' })
      if (body.password.length < 6) {
        return reply.code(400).send({ error: 'Password must be at least 6 characters' })
      }
      const passwordHash = await bcrypt.hash(body.password, 10)
      const doc = await User.create({
        email: body.email.trim().toLowerCase(),
        passwordHash,
        name: body.name?.trim() || undefined,
        imageUrl: body.imageUrl?.trim() || undefined,
        role,
        stateId: body.stateId || undefined,
        warehouseId: body.warehouseId || undefined,
      })
      const user = await User.findById(doc._id).select('-passwordHash').lean()
      return reply.code(201).send(user)
    })

    instance.get<{ Querystring: { stateId?: string; role?: string } }>(
      '/api/v1/users',
      async (request: AuthenticatedRequest, reply) => {
        const q = request.query as { stateId?: string; role?: string }
        const filter: any = {}
        const scope = requireStateScope(request)
        if (q.stateId) {
          if (request.role !== 'admin' && scope !== q.stateId) {
            return reply.code(403).send({ error: 'State not in scope' })
          }
          filter.stateId = q.stateId
        } else if (request.role !== 'admin' && scope) {
          filter.stateId = scope
        }
        if (q.role) filter.role = q.role
        const users = await User.find(filter).select('-passwordHash').sort({ email: 1 }).lean()
        const driverUserIds = users.filter((u) => u.role === 'driver').map((u) => u._id)
        const drivers = await Driver.find({ userId: { $in: driverUserIds } }).lean()
        const driverByUserId = new Map(drivers.map((d) => [String(d.userId), d]))
        const list = users.map((u) => ({
          ...u,
          driverId: u.role === 'driver' ? driverByUserId.get(String(u._id))?._id : null,
          driverName: u.role === 'driver' ? driverByUserId.get(String(u._id))?.name : null,
        }))
        return reply.send(list)
      }
    )

    instance.get<{ Params: { id: string } }>(
      '/api/v1/users/:id',
      async (request: AuthenticatedRequest, reply) => {
        const params = request.params as { id: string }
        const user = await User.findById(params.id).select('-passwordHash').lean()
        if (!user) return reply.code(404).send({ error: 'User not found' })
        if (user.role === 'driver') {
          const driver = await Driver.findOne({ userId: user._id }).lean()
          return reply.send({ ...user, driver: driver || null })
        }
        return reply.send(user)
      }
    )

    instance.patch<{ Params: { id: string }; Body: { active?: boolean; stateId?: string; role?: string; name?: string } }>(
      '/api/v1/users/:id',
      async (request: AuthenticatedRequest, reply) => {
        const params = request.params as { id: string }
        if (request.role !== 'admin') {
          return reply.code(403).send({ error: 'Admin only' })
        }
        const body = request.body as any
        const update: any = {}
        if (typeof body.active === 'boolean') update.active = body.active
        if (body.stateId !== undefined) update.stateId = body.stateId || null
        if (body.role) update.role = body.role
        if (body.name !== undefined) update.name = body.name?.trim() || undefined
        const user = await User.findByIdAndUpdate(params.id, update, { new: true }).select('-passwordHash').lean()
        if (!user) return reply.code(404).send({ error: 'User not found' })
        return reply.send(user)
      }
    )
  })
}
