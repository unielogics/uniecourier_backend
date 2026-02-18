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

// All US states + DC for Service areas dropdown and other config
const US_STATES = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' }, { code: 'AZ', name: 'Arizona' }, { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' }, { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' }, { code: 'FL', name: 'Florida' }, { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' }, { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' }, { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' }, { code: 'LA', name: 'Louisiana' }, { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' }, { code: 'MA', name: 'Massachusetts' }, { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' }, { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' }, { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' }, { code: 'NJ', name: 'New Jersey' }, { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' }, { code: 'NC', name: 'North Carolina' }, { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' }, { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' }, { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' }, { code: 'TN', name: 'Tennessee' }, { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' }, { code: 'VT', name: 'Vermont' }, { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' }, { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' },
]

async function seed(): Promise<void> {
  await connectDB()
  for (const c of NJ_ZIP_CENTROIDS) {
    await ZipCentroid.findOneAndUpdate({ zip: c.zip }, c, { upsert: true })
  }
  for (const s of US_STATES) {
    await State.findOneAndUpdate(
      { code: s.code },
      { code: s.code, name: s.name, timezone: 'America/New_York' },
      { upsert: true }
    )
  }
  console.log(`Upserted ${US_STATES.length} states (all US + DC).`)
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
