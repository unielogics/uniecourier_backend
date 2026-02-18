import { Order } from '../models/Order'
import { RouteStop } from '../models/RouteStop'

export interface OrderRow {
  id: string
  stateId: string
  warehouseId: string | null
  externalOrderId: string | null
  externalShipmentId: string | null
  status: string
  addressLine1: string
  addressCity: string
  addressState: string
  addressZip: string
  createdAt: Date
  updatedAt: Date
}

export async function createOrder(data: {
  stateId: string
  originHubId?: string
  warehouseId?: string
  externalOrderId?: string
  externalShipmentId?: string
  addressLine1: string
  addressCity: string
  addressState: string
  addressZip: string
  addressName?: string
  addressCompany?: string
  addressLine2?: string
  addressCountry?: string
  deadlineAt?: Date
  itemType?: string
  weightLbs?: number
  lengthIn?: number
  widthIn?: number
  heightIn?: number
  rateTotalCents?: number
  billingName?: string
  billingCompany?: string
  billingEmail?: string
  billingPhone?: string
  status?: string
  sku?: string
  itemName?: string
  image?: string
  description?: string
  quantityUnits?: number
}): Promise<string> {
  const doc = await Order.create({
    stateId: data.stateId,
    originHubId: data.originHubId,
    warehouseId: data.warehouseId,
    externalOrderId: data.externalOrderId,
    externalShipmentId: data.externalShipmentId,
    status: data.status ?? 'pending_pickup',
    addressLine1: data.addressLine1,
    addressCity: data.addressCity,
    addressState: data.addressState,
    addressZip: data.addressZip,
    addressName: data.addressName,
    addressCompany: data.addressCompany,
    addressLine2: data.addressLine2,
    addressCountry: data.addressCountry || 'US',
    deadlineAt: data.deadlineAt,
    itemType: data.itemType || 'parcel',
    weightLbs: data.weightLbs,
    lengthIn: data.lengthIn,
    widthIn: data.widthIn,
    heightIn: data.heightIn,
    rateTotalCents: data.rateTotalCents,
    billingName: data.billingName,
    billingCompany: data.billingCompany,
    billingEmail: data.billingEmail,
    billingPhone: data.billingPhone,
    sku: data.sku,
    itemName: data.itemName,
    image: data.image,
    description: data.description,
    quantityUnits: data.quantityUnits,
  })
  return String(doc._id)
}

export async function findOrderById(id: string): Promise<OrderRow | null> {
  const doc = await Order.findById(id).lean()
  if (!doc) return null
  return {
    id: String(doc._id),
    stateId: String(doc.stateId),
    warehouseId: doc.warehouseId ? String(doc.warehouseId) : null,
    externalOrderId: doc.externalOrderId ?? null,
    externalShipmentId: doc.externalShipmentId ?? null,
    status: doc.status,
    addressLine1: doc.addressLine1,
    addressCity: doc.addressCity,
    addressState: doc.addressState,
    addressZip: doc.addressZip,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

export async function listOrdersByStatePending(stateId: string): Promise<OrderRow[]> {
  const docs = await Order.find({ stateId, status: { $in: ['pending', 'pending_pickup'] } })
    .sort({ createdAt: 1 })
    .lean()
  return docs.map((d) => ({
    id: String(d._id),
    stateId: String(d.stateId),
    warehouseId: d.warehouseId ? String(d.warehouseId) : null,
    externalOrderId: d.externalOrderId ?? null,
    externalShipmentId: d.externalShipmentId ?? null,
    status: d.status,
    addressLine1: d.addressLine1,
    addressCity: d.addressCity,
    addressState: d.addressState,
    addressZip: d.addressZip,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }))
}

export async function markOrderInRoute(orderId: string): Promise<void> {
  await Order.findByIdAndUpdate(orderId, { status: 'in_route' })
}

export async function updateOrderStatus(orderId: string, status: string): Promise<void> {
  await Order.findByIdAndUpdate(orderId, { status })
}

export async function getOrdersByRouteId(routeId: string): Promise<OrderRow[]> {
  const stops = await RouteStop.find({ routeId }).sort({ sequence: 1 }).lean()
  const orderIds = stops.map((s) => s.orderId)
  const orders = await Order.find({ _id: { $in: orderIds } }).lean()
  const byId = new Map(orders.map((o) => [String(o._id), o]))
  return stops.map((s) => {
    const o = byId.get(String(s.orderId))!
    return {
      id: String(o._id),
      stateId: String(o.stateId),
      warehouseId: o.warehouseId ? String(o.warehouseId) : null,
      externalOrderId: o.externalOrderId ?? null,
      externalShipmentId: o.externalShipmentId ?? null,
      status: o.status,
      addressLine1: o.addressLine1,
      addressCity: o.addressCity,
      addressState: o.addressState,
      addressZip: o.addressZip,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    }
  })
}
