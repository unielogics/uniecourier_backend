# WMS → UnieCourier: Orders Ready API

**Endpoint:** `POST /api/v1/wms/orders-ready`  
**Auth:** Header `x-wms-webhook-secret` (must match `WMS_WEBHOOK_SECRET` env).

Use this from the kiosk/WMS when an order is ready to ship. UnieCourier creates the order/shipment, calculates the rate, and returns `orderId` and total.

## Field mapping (WMS → UnieCourier)

| WMS / Kiosk | API field | UnieCourier order |
|-------------|-----------|-------------------|
| **Item** | | |
| SKU | `sku` | `sku` |
| Item title | `itemTitle` or `itemName` | `itemName` |
| Image URL | `image` | `image` |
| Description | `description` | `description` |
| Number of units | `quantityUnits` | `quantityUnits` |
| **Shipping address** | `address` | |
| Line 1 | `address.line1` | `addressLine1` |
| Line 2 | `address.line2` | `addressLine2` |
| City | `address.city` | `addressCity` |
| State (2-letter) | `address.state` | `addressState` |
| ZIP | `address.zip` | `addressZip` |
| Recipient name | `address.name` | `addressName` |
| Company | `address.company` | `addressCompany` |
| Country | `address.country` | `addressCountry` |
| **Weight & dimensions** | | |
| Weight (lbs) | `weightLbs` | `weightLbs` |
| Length (in) | `lengthIn` | `lengthIn` |
| Width (in) | `widthIn` | `widthIn` |
| Height (in) | `heightIn` | `heightIn` |
| Item type (kiosk = parcel) | `itemType` | `itemType` (default `parcel`) |
| **Ship-from (warehouse)** | `shipFrom` | `originHubId` |
| UnieCourier hub ID | `shipFrom.originHubId` | used as `originHubId` |
| Warehouse code (fallback) | `shipFrom.warehouseCode` | first active hub in state used if no `originHubId` |
| **Bill-to (intermediary)** | `billTo` | Billing on order |
| Name (required) | `billTo.name` | `billingName` |
| Company | `billTo.company` | `billingCompany` |
| Email | `billTo.email` | `billingEmail` |
| Phone | `billTo.phone` | `billingPhone` |
| **Other** | | |
| WMS order ID | `orderId` | `externalOrderId` |
| WMS shipment ID | `shipmentId` | `externalShipmentId` |
| Warehouse ID | `warehouseId` | `warehouseId` |
| Deadline | `deadlineAt` (ISO string) | `deadlineAt` |

## Example request body

```json
{
  "orderId": "WMS-ORD-12345",
  "shipmentId": "SHIP-67890",
  "address": {
    "line1": "123 Main St",
    "line2": "Suite 4",
    "city": "Newark",
    "state": "NJ",
    "zip": "07102",
    "name": "Jane Doe",
    "company": "Acme Inc",
    "country": "US"
  },
  "weightLbs": 5,
  "lengthIn": 10,
  "widthIn": 8,
  "heightIn": 6,
  "itemType": "parcel",
  "sku": "WIDGET-001",
  "itemTitle": "Blue Widget",
  "image": "https://example.com/widget.jpg",
  "description": "Standard size",
  "quantityUnits": 2,
  "shipFrom": {
    "originHubId": "<UnieCourier Hub _id>"
  },
  "billTo": {
    "name": "John Smith",
    "company": "Acme Inc",
    "email": "billing@acme.com",
    "phone": "+1 555 123 4567"
  }
}
```

## Response

```json
{
  "orderId": "<UnieCourier order _id>",
  "stateId": "<state _id>",
  "totalCents": 1250,
  "totalDollars": "12.50"
}
```

## Intermediary → billTo

In UnieWMS, the **intermediary** is the client/customer to bill. When sending to UnieCourier, map intermediary fields to `billTo`:

- `billTo.name` = intermediary display name (e.g. `firstName + " " + lastName` or `companyName` if no name) — **required**
- `billTo.company` = `intermediary.companyName`
- `billTo.email` = `intermediary.email`
- `billTo.phone` = `intermediary.phone`

This ensures the shipment’s bill-to on the order matches the intermediary and processes seamlessly.

## Kiosk step 3: 4x6 label preview and print

When the shipment is created via this API, store the returned **orderId** (UnieCourier shipment id) on the WMS order so the kiosk can show the 4x6 label in step 3:

1. After calling `POST /api/v1/wms/orders-ready`, you receive `{ orderId, stateId, totalCents, totalDollars }`.
2. Update the WMS order with `shipping.uniecourierOrderId = orderId` (e.g. via WMS `PUT /api/v1/orders/:id` with `{ shipping: { uniecourierOrderId: "<orderId>" } }`, or via kiosk **update-order-carrier** with `carrierDetails.uniecourierOrderId` when the user selects UnieCourier).
3. In step 3 of the kiosk, when the user has selected UnieCourier, call WMS **GET /api/v1/kiosk/uniecourier-label?orderId=<WMS order id>**. The response is `{ labelHtml, uniecourierOrderId }`. Render `labelHtml` in an iframe or new window for preview and use the browser print (or kiosk auto-print) for the 4x6 label.

UnieCourier also exposes **GET /api/v1/wms/shipments/:id/label** (with header `x-wms-webhook-secret`) so the WMS backend can fetch the label HTML by UnieCourier shipment id.
