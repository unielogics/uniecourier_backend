export type Role = 'admin' | 'manager' | 'dispatcher' | 'warehouse' | 'driver'
export type RouteStatus = 'available' | 'assigned' | 'in_progress' | 'completed' | 'cancelled'
export type StopStatus = 'pending' | 'completed' | 'failed'
export type OrderStatus = 'pending' | 'in_route' | 'delivered' | 'failed' | 'cancelled'

export interface JwtPayload {
  userId: string
  email: string
  role: Role
  stateId?: string
  warehouseId?: string
  driverId?: string
  iat?: number
  exp?: number
}

export interface AuthRequest {
  userId?: string
  role?: Role
  stateId?: string
  warehouseId?: string
  driverId?: string
}
