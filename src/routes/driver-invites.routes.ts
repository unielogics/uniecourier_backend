import { FastifyInstance } from 'fastify'
import crypto from 'crypto'
import { authMiddleware, requireRole, requireStateScope, type AuthenticatedRequest } from '../middleware/auth'
import { DriverInvite } from '../models/DriverInvite'
import { Driver } from '../models/Driver'
import { User } from '../models/User'
import { DriverZipCoverage } from '../models/DriverZipCoverage'
import bcrypt from 'bcryptjs'
import { s3, getPODBucket, driverDocKey } from '../config/s3'

const INVITE_EXPIRY_DAYS = 7

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

export async function registerDriverInvitesRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (instance) => {
    instance.addHook('preHandler', authMiddleware)
    instance.addHook('preHandler', requireRole('admin', 'manager', 'dispatcher'))

    instance.post<{ Body: { stateId: string; email?: string } }>(
      '/api/v1/driver-invites',
      async (request: AuthenticatedRequest, reply) => {
        const body = request.body as { stateId: string; email?: string }
        if (!body.stateId) {
          return reply.code(400).send({ error: 'stateId required' })
        }
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== body.stateId) {
          return reply.code(403).send({ error: 'State not in scope' })
        }
        const expiresAt = new Date()
        expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS)
        const token = generateToken()
        const invite = await DriverInvite.create({
          stateId: body.stateId,
          email: body.email ? body.email.toLowerCase().trim() : undefined,
          token,
          status: 'pending',
          expiresAt,
          invitedBy: request.userId,
        })
        const inviteUrl = `${process.env.DASHBOARD_URL || 'http://localhost:7000'}/driver/apply?token=${token}`
        return reply.send({
          id: invite._id,
          email: invite.email,
          expiresAt: invite.expiresAt,
          inviteUrl,
        })
      }
    )

    instance.get<{ Querystring: { stateId: string } }>(
      '/api/v1/driver-invites',
      async (request: AuthenticatedRequest, reply) => {
        const stateId = (request.query as { stateId?: string }).stateId
        if (!stateId) return reply.code(400).send({ error: 'stateId required' })
        const scope = requireStateScope(request)
        if (request.role !== 'admin' && scope !== stateId) {
          return reply.code(403).send({ error: 'State not in scope' })
        }
        const invites = await DriverInvite.find({ stateId })
          .sort({ createdAt: -1 })
          .populate('invitedBy', 'email')
          .lean()
        return reply.send(invites)
      }
    )
  })

  // Upload driver document (license front/back, driver photo) — public, token-validated
  app.post<{}>('/api/v1/driver-invites/upload-document', async (request, reply) => {
    let token = ''
    let docType = ''
    let buffer: Buffer | null = null
    let mimetype = 'image/jpeg'
    const parts = (request as any).parts()
    for await (const part of parts) {
      if (part.fieldname === 'token') token = String(part.value ?? '').trim()
      else if (part.fieldname === 'docType') docType = String(part.value ?? '').trim()
      else if (part.fieldname === 'file' && part.file) {
        buffer = await part.toBuffer()
        mimetype = part.mimetype || 'image/jpeg'
      }
    }
    if (!buffer) return reply.code(400).send({ error: 'No file uploaded' })
    const validTypes = ['license_front', 'license_back', 'driver_photo']
    if (!token || !validTypes.includes(docType)) {
      return reply.code(400).send({ error: 'token and docType (license_front|license_back|driver_photo) required' })
    }
    const invite = await DriverInvite.findOne({ token, status: 'pending' })
    if (!invite) return reply.code(404).send({ error: 'Invite not found or expired' })
    if (new Date() > invite.expiresAt) {
      await DriverInvite.updateOne({ _id: invite._id }, { status: 'expired' })
      return reply.code(410).send({ error: 'Invite expired' })
    }
    const ext = (mimetype === 'image/png' ? 'png' : mimetype === 'image/jpeg' || mimetype === 'image/jpg' ? 'jpg' : 'jpg')
    const key = driverDocKey(token, docType, ext)
    try {
      await s3.putObject({
        Bucket: getPODBucket(),
        Key: key,
        Body: buffer,
        ContentType: mimetype,
      }).promise()
    } catch (err) {
      request.log.error(err, 'S3 upload failed')
      return reply.code(500).send({ error: 'Upload failed' })
    }
    return reply.send({ key })
  })

  app.get<{ Querystring: { token: string } }>(
    '/api/v1/driver-invites/validate',
    async (request, reply) => {
      const token = (request.query as { token?: string }).token
      if (!token) return reply.code(400).send({ error: 'token required' })
      const invite = await DriverInvite.findOne({ token, status: 'pending' }).populate('stateId', 'code name').lean()
      if (!invite) return reply.code(404).send({ error: 'Invite not found or expired' })
      if (new Date() > new Date(invite.expiresAt)) {
        await DriverInvite.updateOne({ _id: invite._id }, { status: 'expired' })
        return reply.code(410).send({ error: 'Invite expired' })
      }
      return reply.send({ valid: true, email: invite.email || null, state: invite.stateId })
    }
  )

  app.post<{
    Body: {
      token: string
      name: string
      email: string
      phone?: string
      addressLine1?: string
      addressCity?: string
      addressState?: string
      addressZip?: string
      maxMilesPerDay?: number
      vehicleType?: string
      vehicleMake?: string
      vehicleModel?: string
      vehicleDescription?: string
      insurancePolicyNumber?: string
      insuranceExpiry?: string
      licenseNumber?: string
      licenseState?: string
      licenseExpiry?: string
      licenseImageFrontKey?: string
      licenseImageBackKey?: string
      driverPhotoKey?: string
      password: string
      zips?: string[]
    }
  }>('/api/v1/driver-invites/apply', async (request, reply) => {
    const body = request.body as any
    if (!body?.token || !body?.name || !body?.email || !body?.password) {
      return reply.code(400).send({ error: 'token, name, email, password required' })
    }
    const licenseImageFrontKey = body.licenseImageFrontKey?.trim() || undefined
    const licenseImageBackKey = body.licenseImageBackKey?.trim() || undefined
    const driverPhotoKey = body.driverPhotoKey?.trim() || undefined
    const invite = await DriverInvite.findOne({ token: body.token, status: 'pending' })
    if (!invite) return reply.code(404).send({ error: 'Invite not found or expired' })
    if (new Date() > invite.expiresAt) {
      await DriverInvite.updateOne({ _id: invite._id }, { status: 'expired' })
      return reply.code(410).send({ error: 'Invite expired' })
    }
    const existingUser = await User.findOne({ email: body.email.toLowerCase() })
    if (existingUser) return reply.code(400).send({ error: 'Email already registered' })
    const passwordHash = await bcrypt.hash(body.password, 10)
    const user = await User.create({
      email: body.email.toLowerCase(),
      passwordHash,
      role: 'driver',
      stateId: invite.stateId,
      active: true,
    })
    const insuranceExpiry = body.insuranceExpiry ? new Date(body.insuranceExpiry) : undefined
    const licenseExpiry = body.licenseExpiry ? new Date(body.licenseExpiry) : undefined
    const driver = await Driver.create({
      stateId: invite.stateId,
      userId: user._id,
      name: body.name,
      email: body.email,
      phone: body.phone,
      addressLine1: body.addressLine1,
      addressCity: body.addressCity,
      addressState: body.addressState,
      addressZip: body.addressZip,
      maxMilesPerDay: body.maxMilesPerDay != null ? Number(body.maxMilesPerDay) : undefined,
      vehicleType: body.vehicleType,
      vehicleMake: body.vehicleMake,
      vehicleModel: body.vehicleModel,
      vehicleDescription: body.vehicleDescription,
      insurancePolicyNumber: body.insurancePolicyNumber,
      insuranceExpiry,
      licenseNumber: body.licenseNumber,
      licenseState: body.licenseState,
      licenseExpiry,
      licenseImageFrontKey,
      licenseImageBackKey,
      driverPhotoKey,
      applicationStatus: 'pending_review',
      active: false,
    })
    const zipsToAdd = Array.isArray(body.zips) && body.zips.length
      ? body.zips
      : body.addressZip ? [String(body.addressZip).trim()] : []
    if (zipsToAdd.length) {
      await DriverZipCoverage.insertMany(
        zipsToAdd.map((zip: string) => ({ driverId: driver._id, zip: String(zip).trim() }))
      )
    }
    await DriverInvite.updateOne(
      { _id: invite._id },
      { status: 'accepted', acceptedAt: new Date(), driverId: driver._id }
    )
    return reply.send({ success: true, userId: String(user._id), driverId: String(driver._id) })
  })
}
