import { Route } from '../models/Route'
import { RouteExpirationAlert } from '../models/RouteExpirationAlert'

const ALERT_MINUTES = parseInt(process.env.ROUTE_AVAILABLE_ALERT_MINUTES || '30', 10)

export async function flagExpiredAvailableRoutes(): Promise<number> {
  const cutoff = new Date(Date.now() - ALERT_MINUTES * 60 * 1000)
  const routes = await Route.find({
    status: 'available',
    availableAt: { $lt: cutoff },
  }).lean()
  let count = 0
  for (const r of routes) {
    const existing = await RouteExpirationAlert.findOne({
      routeId: r._id,
      acknowledgedAt: null,
    })
    if (!existing) {
      await RouteExpirationAlert.create({
        routeId: r._id,
        stateId: r.stateId,
        availableAt: r.availableAt,
      })
      count++
    }
  }
  return count
}

export async function getExpirationAlertsForState(stateId: string): Promise<
  {
    routeId: string
    stateId: string
    availableAt: string
    alertedAt: string
    acknowledgedAt: string | null
  }[]
> {
  const match: any = { acknowledgedAt: null }
  if (stateId && stateId !== 'all') match.stateId = stateId
  const docs = await RouteExpirationAlert.find(match)
    .sort({ alertedAt: -1 })
    .lean()
  return docs.map((d) => ({
    routeId: String(d.routeId),
    stateId: String(d.stateId),
    availableAt: String(d.availableAt),
    alertedAt: String(d.alertedAt),
    acknowledgedAt: d.acknowledgedAt ? String(d.acknowledgedAt) : null,
  }))
}
