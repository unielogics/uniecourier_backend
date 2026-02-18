import { State } from '../models/State'
import { createRoute, addRouteStop } from '../repos/routes.repo'
import { listOrdersByStatePending, markOrderInRoute } from '../repos/orders.repo'
import { getRatesByStateAndZips, getDefaultRateCents } from '../repos/zip_rate.repo'

const MIN_STOPS = parseInt(process.env.ROUTE_MIN_STOPS || '1', 10)

export async function buildRoutesForState(stateId: string): Promise<{ routesCreated: number }> {
  const orders = await listOrdersByStatePending(stateId)
  if (orders.length < MIN_STOPS) return { routesCreated: 0 }

  const zips = [...new Set(orders.map((o) => o.addressZip))]
  const rates = await getRatesByStateAndZips(stateId, zips)
  const defaultRate = await getDefaultRateCents(stateId)

  const byZip = new Map<string, typeof orders>()
  for (const o of orders) {
    const list = byZip.get(o.addressZip) || []
    list.push(o)
    byZip.set(o.addressZip, list)
  }

  let routesCreated = 0
  for (const [, zipOrders] of byZip) {
    if (zipOrders.length < MIN_STOPS) continue
    const driverPayoutCents =
      rates.get(zipOrders[0].addressZip)?.driverPayoutCents ?? defaultRate.driverPayoutCents
    const clientChargeCents =
      rates.get(zipOrders[0].addressZip)?.clientChargeCents ?? defaultRate.clientChargeCents
    const totalDriver = driverPayoutCents * zipOrders.length
    const totalClient = clientChargeCents * zipOrders.length
    const margin = totalClient - totalDriver

    const routeId = await createRoute({
      stateId,
      totalDriverPayoutCents: totalDriver,
      totalClientChargeCents: totalClient,
      marginCents: margin,
    })
    for (let i = 0; i < zipOrders.length; i++) {
      const o = zipOrders[i]
      await addRouteStop({
        routeId,
        orderId: o.id,
        sequence: i + 1,
        addressLine1: o.addressLine1,
        addressCity: o.addressCity,
        addressState: o.addressState,
        addressZip: o.addressZip,
      })
      await markOrderInRoute(o.id)
    }
    routesCreated++
  }
  return { routesCreated }
}

export async function buildRoutesAllStates(): Promise<{ stateId: string; routesCreated: number }[]> {
  const states = await State.find().lean()
  const results: { stateId: string; routesCreated: number }[] = []
  for (const row of states) {
    const { routesCreated } = await buildRoutesForState(String(row._id))
    results.push({ stateId: String(row._id), routesCreated })
  }
  return results
}
