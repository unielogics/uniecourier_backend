import { Order } from '../models/Order'
import { Route } from '../models/Route'
import { RouteStop } from '../models/RouteStop'
import { Driver } from '../models/Driver'
import { getRatesByStateAndZips, getDefaultRateCents } from './zip_rate.repo'

export interface FinancialOrderRow {
  orderId: string
  stateId: string
  originWarehouseCode: string | null
  originWarehouseName: string | null
  intermediaryId: string | null
  intermediaryName: string | null
  chargeCents: number
  payoutCents: number
  profitCents: number
  deliveredAt: Date
}

export interface FinancialSummary {
  totalRevenueCents: number
  totalExpensesCents: number
  totalProfitCents: number
  shipmentCount: number
}

export interface FinancialByWarehouse {
  originWarehouseCode: string
  originWarehouseName: string | null
  revenueCents: number
  expensesCents: number
  profitCents: number
  shipmentCount: number
}

export interface FinancialByIntermediary {
  intermediaryId: string
  intermediaryName: string | null
  revenueCents: number
  expensesCents: number
  profitCents: number
  shipmentCount: number
}

export interface FinancialTimeSeriesBucket {
  date: string
  revenueCents: number
  expensesCents: number
  profitCents: number
  shipmentCount: number
}

export interface FinancialResult {
  summary: FinancialSummary
  byWarehouse: FinancialByWarehouse[]
  byIntermediary: FinancialByIntermediary[]
  timeSeries: FinancialTimeSeriesBucket[]
  rows: FinancialOrderRow[]
}

function toYmd(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * Fetch billable orders: on completed route stops (RouteStop.status === 'completed') or Order.status === 'delivered'.
 * Uses RouteStop.completedAt as deliveredAt when available; otherwise Order.updatedAt.
 */
export async function getFinancialOrders(params: {
  stateIds: string[]
  startDate: Date
  endDate: Date
  originWarehouseCode?: string
  intermediaryId?: string
}): Promise<FinancialOrderRow[]> {
  const { stateIds, startDate, endDate, originWarehouseCode, intermediaryId } = params
  const stateFilter = stateIds.length === 1 ? { stateId: stateIds[0] } : { stateId: { $in: stateIds } }

  // 1. Orders from completed route stops (use RouteStop.completedAt for delivery date)
  const completedRoutes = await Route.find({
    ...stateFilter,
    status: 'completed',
  })
    .select('_id')
    .lean()
  const completedRouteIds = completedRoutes.map((r: any) => r._id)
  const completedStops = await RouteStop.find({
    routeId: { $in: completedRouteIds },
    status: 'completed',
    completedAt: { $gte: startDate, $lte: endDate },
  })
    .select('orderId routeId completedAt')
    .lean()
  const orderIdsFromStops = [...new Set((completedStops as any[]).map((s) => String(s.orderId)))]

  // 2. Also include orders with status 'delivered' that might not be on a route (WMS-originated)
  const deliveredOrdersMatch: any = {
    ...stateFilter,
    status: 'delivered',
    $or: [
      { updatedAt: { $gte: startDate, $lte: endDate } },
      { createdAt: { $gte: startDate, $lte: endDate } },
    ],
  }
  if (originWarehouseCode) deliveredOrdersMatch.originWarehouseCode = originWarehouseCode
  if (intermediaryId) deliveredOrdersMatch.intermediaryId = intermediaryId

  const deliveredOnlyOrders = await Order.find(deliveredOrdersMatch)
    .select('_id stateId originWarehouseCode originWarehouseName intermediaryId intermediaryName rateTotalCents addressZip updatedAt createdAt')
    .lean()

  const deliveredOnlyIds = new Set(
    deliveredOnlyOrders.map((o: any) => String(o._id))
  )
  const fromStopsIds = new Set(orderIdsFromStops)
  const allOrderIds = [...new Set([...fromStopsIds, ...deliveredOnlyIds])]

  if (allOrderIds.length === 0) return []

  const orders = await Order.find({ _id: { $in: allOrderIds } })
    .select('_id stateId originWarehouseCode originWarehouseName intermediaryId intermediaryName rateTotalCents addressZip updatedAt createdAt')
    .lean()

  const stopByOrderId = new Map<string, { completedAt: Date }>()
  for (const s of completedStops as any[]) {
    const oid = String(s.orderId)
    const completedAt = s.completedAt ? new Date(s.completedAt) : null
    if (completedAt) {
      const existing = stopByOrderId.get(oid)
      if (!existing || completedAt > existing.completedAt) {
        stopByOrderId.set(oid, { completedAt })
      }
    }
  }

  const allZips = [...new Set((orders as any[]).map((o) => o.addressZip).filter(Boolean))]
  const primaryStateId = stateIds[0]
  const zipRates = allZips.length ? await getRatesByStateAndZips(primaryStateId, allZips) : new Map()
  const defaultRate = await getDefaultRateCents(primaryStateId)

  const result: FinancialOrderRow[] = []

  for (const o of orders as any[]) {
    const oid = String(o._id)
    const stop = stopByOrderId.get(oid)
    let deliveredAt: Date
    if (stop?.completedAt) {
      deliveredAt = stop.completedAt
    } else if (o.status === 'delivered' && (o.updatedAt || o.createdAt)) {
      deliveredAt = new Date(o.updatedAt ?? o.createdAt)
    } else {
      continue
    }
    if (deliveredAt < startDate || deliveredAt > endDate) continue

    if (originWarehouseCode && (o.originWarehouseCode || '') !== originWarehouseCode) continue
    if (intermediaryId && (o.intermediaryId || '') !== intermediaryId) continue

    const chargeCents = o.rateTotalCents ?? 0
    const payoutCents = zipRates.get(o.addressZip)?.driverPayoutCents ?? defaultRate.driverPayoutCents
    const profitCents = chargeCents - payoutCents

    result.push({
      orderId: oid,
      stateId: String(o.stateId),
      originWarehouseCode: o.originWarehouseCode ?? null,
      originWarehouseName: o.originWarehouseName ?? null,
      intermediaryId: o.intermediaryId ?? null,
      intermediaryName: o.intermediaryName ?? null,
      chargeCents,
      payoutCents,
      profitCents,
      deliveredAt,
    })
  }

  return result
}

/**
 * Aggregate financial data with filters. Returns summary, by warehouse, by intermediary, time series, and raw rows.
 */
export async function getFinancialData(params: {
  stateIds: string[]
  startDate: Date
  endDate: Date
  originWarehouseCode?: string
  intermediaryId?: string
  includeRows?: boolean
}): Promise<FinancialResult> {
  const rows = await getFinancialOrders(params)

  const summary: FinancialSummary = {
    totalRevenueCents: 0,
    totalExpensesCents: 0,
    totalProfitCents: 0,
    shipmentCount: rows.length,
  }
  for (const r of rows) {
    summary.totalRevenueCents += r.chargeCents
    summary.totalExpensesCents += r.payoutCents
    summary.totalProfitCents += r.profitCents
  }

  const byWarehouseMap = new Map<string, FinancialByWarehouse>()
  const byIntermediaryMap = new Map<string, FinancialByIntermediary>()
  const timeSeriesMap = new Map<string, FinancialTimeSeriesBucket>()

  for (const r of rows) {
    const whKey = r.originWarehouseCode ?? '__unknown__'
    if (!byWarehouseMap.has(whKey)) {
      byWarehouseMap.set(whKey, {
        originWarehouseCode: r.originWarehouseCode ?? '',
        originWarehouseName: r.originWarehouseName ?? null,
        revenueCents: 0,
        expensesCents: 0,
        profitCents: 0,
        shipmentCount: 0,
      })
    }
    const wh = byWarehouseMap.get(whKey)!
    wh.revenueCents += r.chargeCents
    wh.expensesCents += r.payoutCents
    wh.profitCents += r.profitCents
    wh.shipmentCount += 1

    const intKey = r.intermediaryId ?? '__unknown__'
    if (!byIntermediaryMap.has(intKey)) {
      byIntermediaryMap.set(intKey, {
        intermediaryId: r.intermediaryId ?? '',
        intermediaryName: r.intermediaryName ?? null,
        revenueCents: 0,
        expensesCents: 0,
        profitCents: 0,
        shipmentCount: 0,
      })
    }
    const int_ = byIntermediaryMap.get(intKey)!
    int_.revenueCents += r.chargeCents
    int_.expensesCents += r.payoutCents
    int_.profitCents += r.profitCents
    int_.shipmentCount += 1

    const dateKey = toYmd(r.deliveredAt)
    if (!timeSeriesMap.has(dateKey)) {
      timeSeriesMap.set(dateKey, {
        date: dateKey,
        revenueCents: 0,
        expensesCents: 0,
        profitCents: 0,
        shipmentCount: 0,
      })
    }
    const ts = timeSeriesMap.get(dateKey)!
    ts.revenueCents += r.chargeCents
    ts.expensesCents += r.payoutCents
    ts.profitCents += r.profitCents
    ts.shipmentCount += 1
  }

  const byWarehouse = Array.from(byWarehouseMap.values()).filter((w) => w.originWarehouseCode !== '__unknown__' || w.shipmentCount > 0)
  const byIntermediary = Array.from(byIntermediaryMap.values()).filter((i) => i.intermediaryId !== '__unknown__' || i.shipmentCount > 0)
  const timeSeries = Array.from(timeSeriesMap.values()).sort((a, b) => a.date.localeCompare(b.date))

  return {
    summary,
    byWarehouse,
    byIntermediary,
    timeSeries,
    rows: params.includeRows !== false ? rows : [],
  }
}

/**
 * Get distinct warehouse codes for filter dropdown.
 */
export async function getWarehouseCodesForFilter(stateIds: string[]): Promise<{ code: string; name: string | null }[]> {
  const stateFilter = stateIds.length === 1 ? { stateId: stateIds[0] } : { stateId: { $in: stateIds } }
  const docs = await Order.find({
    ...stateFilter,
    originWarehouseCode: { $exists: true, $nin: [null, ''] },
  })
    .select('originWarehouseCode originWarehouseName')
    .lean()
  const seen = new Set<string>()
  const result: { code: string; name: string | null }[] = []
  for (const d of docs as any[]) {
    const code = (d.originWarehouseCode || '').trim()
    if (code && !seen.has(code)) {
      seen.add(code)
      result.push({ code, name: d.originWarehouseName?.trim() || null })
    }
  }
  result.sort((a, b) => (a.name || a.code).localeCompare(b.name || b.code))
  return result
}

/**
 * Get distinct intermediaries for filter dropdown (optionally filtered by warehouse).
 */
export async function getIntermediariesForFilter(
  stateIds: string[],
  originWarehouseCode?: string
): Promise<{ id: string; name: string | null }[]> {
  const stateFilter = stateIds.length === 1 ? { stateId: stateIds[0] } : { stateId: { $in: stateIds } }
  const match: any = { ...stateFilter, intermediaryId: { $exists: true, $nin: [null, ''] } }
  if (originWarehouseCode) match.originWarehouseCode = originWarehouseCode
  const docs = await Order.find(match)
    .select('intermediaryId intermediaryName')
    .lean()
  const seen = new Set<string>()
  const result: { id: string; name: string | null }[] = []
  for (const d of docs as any[]) {
    const id = (d.intermediaryId || '').trim()
    if (id && !seen.has(id)) {
      seen.add(id)
      result.push({ id, name: (d as any).intermediaryName?.trim() || null })
    }
  }
  result.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
  return result
}

// --- Driver report ---

export interface DriverReportSummary {
  totalStops: number
  totalPayoutCents: number
  routeCount: number
  driverCount: number
  avgStopsPerDay: number
  avgIncomePerDayCents: number
}

export interface DriverReportByDriver {
  driverId: string
  driverName: string
  driverEmail: string | null
  active: boolean
  onHold: boolean
  totalStops: number
  totalPayoutCents: number
  routeCount: number
  avgStopsPerDay: number
  avgIncomePerDayCents: number
}

export interface DriverReportRouteRow {
  routeId: string
  completedAt: string
  stops: number
  payoutCents: number
}

export interface DriverReportResult {
  summary: DriverReportSummary
  byDriver: DriverReportByDriver[]
  routes?: DriverReportRouteRow[]
}

/**
 * Get driver report: completed routes aggregated by driver. State-wide first; filter by driverId for detail.
 */
export async function getDriverReportData(params: {
  stateIds: string[]
  startDate: Date
  endDate: Date
  driverId?: string
  includeRoutes?: boolean
}): Promise<DriverReportResult> {
  const { stateIds, startDate, endDate, driverId, includeRoutes } = params
  const stateFilter = stateIds.length === 1 ? { stateId: stateIds[0] } : { stateId: { $in: stateIds } }
  const routeMatch: any = {
    ...stateFilter,
    status: 'completed',
    completedAt: { $gte: startDate, $lte: endDate },
  }
  if (driverId) routeMatch.assignedDriverId = driverId
  const routes = await Route.find(routeMatch).select('_id assignedDriverId totalDriverPayoutCents completedAt').lean()
  const routeIds = routes.map((r: any) => r._id)
  const stops = await RouteStop.find({ routeId: { $in: routeIds }, status: 'completed' }).lean()
  const stopsByRoute = new Map<string, number>()
  for (const s of stops as any[]) {
    const rid = String(s.routeId)
    stopsByRoute.set(rid, (stopsByRoute.get(rid) || 0) + 1)
  }
  const driverIds = [...new Set((routes as any[]).map((r) => r.assignedDriverId).filter(Boolean))]
  const drivers = await Driver.find({ _id: { $in: driverIds } }).select('name email active onHold').lean()
  const driverMap = new Map(drivers.map((d: any) => [String(d._id), d]))

  const days = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)))
  const byDriverMap = new Map<string, { stops: number; payoutCents: number; routeCount: number }>()
  const routeRows: DriverReportRouteRow[] = []

  for (const r of routes as any[]) {
    const rid = String(r._id)
    const did = r.assignedDriverId ? String(r.assignedDriverId) : null
    if (!did) continue
    const stopCount = stopsByRoute.get(rid) || 0
    const payoutCents = r.totalDriverPayoutCents ?? 0
    if (!byDriverMap.has(did)) byDriverMap.set(did, { stops: 0, payoutCents: 0, routeCount: 0 })
    const rec = byDriverMap.get(did)!
    rec.stops += stopCount
    rec.payoutCents += payoutCents
    rec.routeCount += 1
    if (includeRoutes && driverId && did === driverId) {
      routeRows.push({
        routeId: rid,
        completedAt: r.completedAt ? new Date(r.completedAt).toISOString() : '',
        stops: stopCount,
        payoutCents,
      })
    }
  }

  const byDriver: DriverReportByDriver[] = []
  let totalStops = 0
  let totalPayoutCents = 0
  let routeCount = 0
  for (const [did, rec] of byDriverMap) {
    const d = driverMap.get(did) as any
    totalStops += rec.stops
    totalPayoutCents += rec.payoutCents
    routeCount += rec.routeCount
    byDriver.push({
      driverId: did,
      driverName: d?.name ?? 'Unknown',
      driverEmail: d?.email ?? null,
      active: d?.active ?? true,
      onHold: d?.onHold ?? false,
      totalStops: rec.stops,
      totalPayoutCents: rec.payoutCents,
      routeCount: rec.routeCount,
      avgStopsPerDay: Math.round((rec.stops / days) * 100) / 100,
      avgIncomePerDayCents: Math.round((rec.payoutCents / days) * 100) / 100,
    })
  }
  byDriver.sort((a, b) => b.totalStops - a.totalStops)
  routeRows.sort((a, b) => b.completedAt.localeCompare(a.completedAt))

  const summary: DriverReportSummary = {
    totalStops,
    totalPayoutCents,
    routeCount,
    driverCount: byDriver.length,
    avgStopsPerDay: Math.round((totalStops / days) * 100) / 100,
    avgIncomePerDayCents: Math.round((totalPayoutCents / days) * 100) / 100,
  }

  return {
    summary,
    byDriver,
    routes: includeRoutes ? routeRows : undefined,
  }
}
