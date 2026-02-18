# UnieCourier database collections

All collections live in the **UnieCourier** database (name from `UNIECOURIER_DB_NAME`, default `uniecourier`). The `users` collection already exists; the rest are created by the app when first used.

| Collection | Model | Purpose |
|------------|--------|---------|
| `users` | User | Platform users (admin, manager, dispatcher, warehouse, driver) |
| `states` | State | States/regions (code, name, timezone) |
| `hubs` | Hub | Custom pickup locations (address, contact) |
| `primary_locations` | PrimaryLocation | Warehouses selected as primary locations per state (from uniewms) |
| `drivers` | Driver | Driver profiles (vehicle, address, max miles, license, insurance) |
| `driver_invites` | DriverInvite | Invite tokens and status for driver signup |
| `driver_zip_coverages` | DriverZipCoverage | Driver service area by ZIP (legacy/supplement) |
| `warehouses` | Warehouse | Local warehouse records (optional; often read from UnieWMS DB) |
| `routes` | Route | Delivery routes (status, driver, payout, client charge) |
| `route_stops` | RouteStop | Stops on a route (order, address, POD) |
| `route_status_logs` | RouteStatusLog | Status change history for routes |
| `route_expiration_alerts` | RouteExpirationAlert | Alerts when routes are about to expire |
| `orders` | Order | Delivery orders (address, warehouse, status) |
| `comments` | Comment | Comments on routes, stops, orders, drivers |
| `issue_reports` | IssueReport | Issues (delivery failed, damage, delay, etc.) |
| `service_area_zips` | ServiceAreaZip | Service area ZIPs per state (with optional labels) |
| `zip_rate_tables` | ZipRateTable | Per-ZIP driver payout and client charge (cents) |
| `zip_centroids` | ZipCentroid | Lat/lon for ZIPs (routing) |
| `override_requests` | OverrideRequest | Approval workflow overrides |
| `proof_of_deliveries` | ProofOfDelivery | POD assets (e.g. S3 keys) per route stop |
| `brokers` | Broker | Brokers (e.g. for freight) |
| `item_type_vehicle_rules` | ItemTypeVehicleRule | Item type → vehicle type rules per state |
| `weight_size_tiers` | WeightSizeTier | Weight/size tiers per state |
| `item_type_surcharges` | ItemTypeSurcharge | Surcharges by item type (and optionally ZIP) per state |
