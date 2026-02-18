import { FastifyRequest, FastifyReply } from 'fastify'
import jwt from 'jsonwebtoken'
import type { JwtPayload, Role } from '../types'

export interface AuthenticatedRequest extends FastifyRequest {
  userId?: string
  role?: Role
  stateId?: string
  warehouseId?: string
  driverId?: string
}

const secret = process.env.JWT_SECRET || 'change-me'

export function signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, secret, { expiresIn: '7d' })
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, secret) as JwtPayload
}

export async function authMiddleware(
  request: AuthenticatedRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Authorization required' })
  }
  try {
    const token = authHeader.slice(7)
    const decoded = verifyToken(token)
    request.userId = decoded.userId
    request.role = decoded.role
    request.stateId = decoded.stateId
    request.warehouseId = decoded.warehouseId
    request.driverId = decoded.driverId
  } catch {
    return reply.code(401).send({ error: 'Invalid or expired token' })
  }
}

export function requireRole(...roles: Role[]) {
  return async (request: AuthenticatedRequest, reply: FastifyReply): Promise<void> => {
    if (!request.role || !roles.includes(request.role)) {
      return reply.code(403).send({ error: 'Insufficient role' })
    }
  }
}

/** Require state scope: admin can pass any state; others must use their assigned stateId */
export function requireStateScope(request: AuthenticatedRequest): string | null {
  if (request.role === 'admin') {
    const q = request.query as { stateId?: string }
    const h = request.headers['x-state-id']
    const stateId = q?.stateId ?? (Array.isArray(h) ? h[0] : h)
    return typeof stateId === 'string' ? stateId : null
  }
  return request.stateId || null
}
