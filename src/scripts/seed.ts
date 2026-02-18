import dotenv from 'dotenv'
dotenv.config()

import bcrypt from 'bcryptjs'
import { connectDB } from '../config/database'
import { State } from '../models/State'
import { User } from '../models/User'
import { ZipCentroid } from '../models/ZipCentroid'

const NJ_ZIP_CENTROIDS = [
  { zip: '07001', lat: 40.75, lon: -74.17 },
  { zip: '07002', lat: 40.81, lon: -74.21 },
  { zip: '07003', lat: 40.64, lon: -74.27 },
  { zip: '08854', lat: 40.50, lon: -74.45 },
  { zip: '08901', lat: 40.48, lon: -74.45 },
]

async function seed(): Promise<void> {
  await connectDB()
  for (const c of NJ_ZIP_CENTROIDS) {
    await ZipCentroid.findOneAndUpdate({ zip: c.zip }, c, { upsert: true })
  }
  await State.findOneAndUpdate(
    { code: 'NJ' },
    { code: 'NJ', name: 'New Jersey', timezone: 'America/New_York' },
    { upsert: true }
  )
  const hashAdmin = await bcrypt.hash('admin123', 10)
  const existingAdmin = await User.findOne({ email: 'admin@uniecourier.com' })
  if (!existingAdmin) {
    await User.create({
      email: 'admin@uniecourier.com',
      passwordHash: hashAdmin,
      role: 'admin',
      active: true,
    })
    console.log('Created admin user: admin@uniecourier.com / admin123')
  } else {
    console.log('Admin user already exists: admin@uniecourier.com')
  }

  const hashFranco = await bcrypt.hash('Legacylife1!', 10)
  const existingFranco = await User.findOne({ email: 'franco@unielogics.com' })
  if (!existingFranco) {
    await User.create({
      email: 'franco@unielogics.com',
      passwordHash: hashFranco,
      role: 'admin',
      active: true,
    })
    console.log('Created admin user: franco@unielogics.com')
  } else {
    await User.updateOne(
      { email: 'franco@unielogics.com' },
      { passwordHash: hashFranco, role: 'admin', active: true }
    )
    console.log('Updated admin user: franco@unielogics.com')
  }

  console.log('Seed done.')
  process.exit(0)
}

seed().catch((e) => {
  console.error(e)
  process.exit(1)
})
