import { State } from '../models/State'
import { Route } from '../models/Route'
import { RouteStop } from '../models/RouteStop'
import { Driver } from '../models/Driver'
import { Order } from '../models/Order'
import { ItemTypeSurcharge } from '../models/ItemTypeSurcharge'

export interface StateSummaryRow {
  state_id: string
  state_code: string
  state_name: string
  open_routes: number
  available: number
  assigned: number
  in_progress: number
  completed_today: number
  failed_stops: number
  queue_count: number
}

export async function getNationalSummary(): Promise<StateSummaryRow[]> {
  const states = await State.find().sort({ code: 1 }).lean()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const results: StateSummaryRow[] = []
  for (const s of states) {
    const routes = await Route.find({
      stateId: s._id,
      status: { $in: ['available', 'assigned', 'in_progress', 'completed'] },
    }).lean()
    const available = routes.filter((r) => r.status === 'available').length
    const assigned = routes.filter((r) => r.status === 'assigned').length
    const inProgress = routes.filter((r) => r.status === 'in_progress').length
    const completedToday = routes.filter(
      (r) => r.status === 'completed' && r.completedAt && new Date(r.completedAt) >= today
    ).length
    const routeIds = routes.map((r) => r._id)
    const failedStops = await RouteStop.countDocuments({
      routeId: { $in: routeIds },
      status: 'failed',
    })
    const queueCount = await Order.countDocuments({
      stateId: s._id,
      status: { $in: ['pending', 'pending_pickup'] },
    })
    results.push({
      state_id: String(s._id),
      state_code: s.code,
      state_name: s.name,
      open_routes: available + assigned + inProgress,
      available,
      assigned,
      in_progress: inProgress,
      completed_today: completedToday,
      failed_stops: failedStops,
      queue_count: queueCount,
    } as any)
  }
  return results
}

export async function getStateMetrics(stateId: string): Promise<{
  available: number
  assigned: number
  inProgress: number
  completedToday: number
  failedStops: number
  avgStopsPerRoute: number
  avgMilesPerRoute: number
  costPerStop: number
  driverAcceptanceRate: number
}> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const routes = await Route.find({ stateId }).lean()
  const available = routes.filter((r) => r.status === 'available').length
  const assigned = routes.filter((r) => r.status === 'assigned').length
  const inProgress = routes.filter((r) => r.status === 'in_progress').length
  const completedToday = routes.filter(
    (r) => r.status === 'completed' && r.completedAt && new Date(r.completedAt) >= today
  ).length
  const routeIds = routes.map((r) => r._id)
  const failedStops = await RouteStop.countDocuments({
    routeId: { $in: routeIds },
    status: 'failed',
  })
  const stopCounts = await RouteStop.aggregate([
    { $match: { routeId: { $in: routeIds } } },
    { $group: { _id: '$routeId', cnt: { $sum: 1 } } },
    { $group: { _id: null, avg: { $avg: '$cnt' } } },
  ])
  const avgStopsPerRoute = stopCounts[0]?.avg ?? 0
  const assignedOrMore = await Route.countDocuments({
    stateId,
    status: { $in: ['assigned', 'in_progress', 'completed'] },
  })
  const totalWithDriver = await Route.countDocuments({
    stateId,
    status: { $in: ['assigned', 'in_progress', 'completed'] },
    assignedDriverId: { $ne: null },
  })
  const driverAcceptanceRate = assignedOrMore > 0 ? totalWithDriver / assignedOrMore : 0
  return {
    available,
    assigned,
    inProgress,
    completedToday,
    failedStops,
    avgStopsPerRoute,
    avgMilesPerRoute: 0,
    costPerStop: 0,
    driverAcceptanceRate,
  }
}

/** Dispatch activity summary: queue, drivers, out for delivery, available drivers */
export interface DispatchSummaryRow {
  queueCount: number
  driversTotal: number
  outForDelivery: number
  availableDrivers: number
  routesAvailable: number
  routesAssigned: number
}

export async function getDispatchSummary(stateId: string): Promise<DispatchSummaryRow> {
  const filterState = stateId && stateId !== 'all'
  const stateFilter = filterState ? { stateId } : {}
  const stateFilterIn = filterState && stateId.includes(',') ? { stateId: { $in: stateId.split(',') } } : stateFilter

  const [queueCount, driversTotal, routesOutForDelivery, routesAvailable, routesAssigned, routesWithDriver] = await Promise.all([
    Order.countDocuments({ ...stateFilterIn, status: { $in: ['pending', 'pending_pickup'] } }),
    Driver.countDocuments({ ...stateFilterIn, active: true }),
    Route.countDocuments({ ...stateFilterIn, status: 'in_progress' }),
    Route.countDocuments({ ...stateFilterIn, status: 'available' }),
    Route.countDocuments({ ...stateFilterIn, status: 'assigned' }),
    Route.find({ ...stateFilterIn, status: { $in: ['assigned', 'in_progress'] }, assignedDriverId: { $ne: null } }).select('assignedDriverId').lean(),
  ])
  const busyDriverIds = new Set((routesWithDriver as any[]).map((r) => String(r.assignedDriverId)).filter(Boolean))
  const allDrivers = await Driver.find(stateFilterIn).select('_id').lean()
  const availableDrivers = allDrivers.filter((d) => !busyDriverIds.has(String(d._id))).length
  return {
    queueCount,
    driversTotal,
    outForDelivery: routesOutForDelivery,
    availableDrivers,
    routesAvailable,
    routesAssigned,
  }
}

export interface MapStateRow {
  state_id: string
  state_code: string
  state_name: string
  drivers_count: number
  shipments_count: number
  fees: { itemType: string; label: string; costCents?: number; type: string; valueCents: number }[]
}

export async function getMapData(): Promise<MapStateRow[]> {
  const states = await State.find().sort({ code: 1 }).lean()
  const results: MapStateRow[] = []
  for (const s of states) {
    const [driversCount, shipmentsCount, stateSurcharges] = await Promise.all([
      Driver.countDocuments({ stateId: s._id, active: true }),
      Order.countDocuments({ stateId: s._id }),
      ItemTypeSurcharge.find({ stateId: s._id, zipCode: '', active: true }).lean(),
    ])
    results.push({
      state_id: String(s._id),
      state_code: s.code,
      state_name: s.name,
      drivers_count: driversCount,
      shipments_count: shipmentsCount,
      fees: (stateSurcharges || []).map((x: any) => ({
        itemType: x.itemType,
        label: x.label || x.itemType,
        costCents: x.costCents,
        type: x.type || 'flat',
        valueCents: x.valueCents ?? 0,
      })),
    })
  }
  return results
}
