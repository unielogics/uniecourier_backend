import Fastify from 'fastify'
import dotenv from 'dotenv'
import cors from '@fastify/cors'
import formbody from '@fastify/formbody'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import { connectDB } from './config/database'
import { registerAuthRoutes } from './routes/auth.routes'
import { registerStateRoutes } from './routes/states.routes'
import { registerDashboardRoutes } from './routes/dashboard.routes'
import { registerRoutesRoutes } from './routes/routes.routes'
import { registerDriverRoutes } from './routes/driver.routes'
import { registerWarehouseRoutes } from './routes/warehouse.routes'
import { registerWmsIntegrationRoutes } from './routes/wms-integration.routes'
import { registerJobsRoutes } from './routes/jobs.routes'
import { registerDriverInvitesRoutes } from './routes/driver-invites.routes'
import { registerSurchargesRoutes } from './routes/surcharges.routes'
import { registerServiceAreasRoutes } from './routes/service-areas.routes'
import { registerHubsRoutes } from './routes/hubs.routes'
import { registerConfigRoutes } from './routes/config.routes'
import { registerCommentsRoutes } from './routes/comments.routes'
import { registerIssuesRoutes } from './routes/issues.routes'
import { registerShipmentsBoardRoutes } from './routes/shipments-board.routes'
import { registerFinancialRoutes } from './routes/financial.routes'
import { registerDisputesRoutes } from './routes/disputes.routes'
import { registerUsersRoutes } from './routes/users.routes'
import { registerProfileRoutes } from './routes/profile.routes'
import { registerRateShopRoutes } from './routes/rate-shop.routes'
import { registerShipmentsRoutes } from './routes/shipments.routes'

dotenv.config()

const app = Fastify({
  logger: { level: process.env.NODE_ENV === 'production' ? 'info' : 'debug' },
})

const defaultOrigins = [
  'http://localhost:3000',
  'http://localhost:4000',
  'http://localhost:5000',
  'http://localhost:7000',
]
const allowedOrigins = [
  ...defaultOrigins,
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean),
]

async function start(): Promise<void> {
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true)
      return cb(null, false)
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-State-Id'],
  })
  // Rate limit: 1000/min to support dashboard parallel requests (was 200, caused 429s on page load)
  const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX || '1000', 10)
  await app.register(rateLimit, { max: rateLimitMax, timeWindow: '1 minute' })
  await app.register(formbody)
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } }) // 10MB for POD

  await registerAuthRoutes(app)
  await registerStateRoutes(app)
  await registerDashboardRoutes(app)
  await registerRoutesRoutes(app)
  await registerDriverRoutes(app)
  await registerWarehouseRoutes(app)
  await registerWmsIntegrationRoutes(app)
  await registerJobsRoutes(app)
  await registerDriverInvitesRoutes(app)
  await registerSurchargesRoutes(app)
  await registerServiceAreasRoutes(app)
  await registerHubsRoutes(app)
  await registerConfigRoutes(app)
  await registerCommentsRoutes(app)
  await registerIssuesRoutes(app)
  await registerShipmentsBoardRoutes(app)
  await registerFinancialRoutes(app)
  await registerDisputesRoutes(app)
  await registerUsersRoutes(app)
  await registerProfileRoutes(app)
  await registerRateShopRoutes(app)
  await registerShipmentsRoutes(app)

  app.get('/health', async (_, reply) => {
    return reply.send({ ok: true, service: 'uniecourier-api' })
  })

  await connectDB()
  const port = Number(process.env.PORT) || 4000
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`UnieCourier API listening on port ${port}`)
}

start().catch((err) => {
  console.error(err)
  process.exit(1)
})
