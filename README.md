# uniecourier_backend

Centralized dispatch API for state-level courier networks.

## Setup

- Node 18+
- MongoDB (UnieCourier uses database `uniecourier`)
- AWS account for S3 (POD storage)

## Env

- `MONGODB_URI` – e.g. `mongodb://localhost:27017` (DB name `uniecourier` used)
- `JWT_SECRET` – Secret for JWT
- `PORT` – Default 4000
- `AWS_REGION`, `S3_POD_BUCKET`, `S3_POD_PREFIX` – S3 for proof-of-delivery

## Commands

- `npm run dev` – Start API
- `npm run build` / `npm start` – Production
- `npm run seed` – Seed admin user and default state (NJ)
# uniecourier_backend
