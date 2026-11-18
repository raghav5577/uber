# Uber Clone: Agent Implementation Plan (gRPC + RabbitMQ)

This plan turns the refined HLD and the LLD sequence diagram into work packages that coding agents can implement in parallel. Read Sections 1-7 first (shared by every agent), then your own work package in Section 8.

## 1. Architecture Decisions

| Concern | Decision |
| --- | --- |
| Language | Go 1.22+ (default; swap if the team prefers, but keep one language for shared packages) |
| Sync service-to-service calls | **gRPC** (protobuf, unary + one client-streaming for location pings) |
| Async events, work queues, timers | **RabbitMQ** (quorum queues, publisher confirms, manual acks) |
| External API (mobile apps) | REST/JSON + WebSocket, terminated at the API Gateway, translated to gRPC |
| Primary DB | PostgreSQL 16 |
| Location + driver state | Redis 7 (GEO + hashes + Lua) |
| Mapping | 3rd party API behind an interface, with a fake for dev and tests |
| Observability | OpenTelemetry traces, Prometheus metrics, structured JSON logs |
| Local infra | docker-compose (Postgres, Redis, RabbitMQ, Jaeger, Prometheus) |

**Rule of thumb for choosing the channel:** if the caller needs an answer now (estimate fare, search drivers, record an offer) use gRPC. If it is a fact that happened, fan-out, a retry, or a timer (ride requested, offer expired, ride assigned) use RabbitMQ.

**Changes from the earlier HLD/LLD caused by this choice:**

- Kafka `ride.requested` (partition by geo cell) becomes a RabbitMQ **consistent-hash exchange** with N queues, so rides of the same geo cell always land on the same queue and the same consumer.
- Kafka delay topics become RabbitMQ **TTL + dead-letter queues** (no plugin needed) for offer timeouts and the 60s match deadline.
- `sendOffer` and ride status pushes are RabbitMQ events consumed by the Notification Service, not direct calls.
- WebSocket connections live in the Notification Service (realtime tier). The API Gateway authenticates and proxies the upgrade request.

## 2. Repository Layout (monorepo)

```
uber-clone/
  proto/                      # owned by Agent 0
    ride/v1/ride.proto
    location/v1/location.proto
    matching/v1/matching.proto   (health only for now)
    common/v1/common.proto
    events/v1/events.proto       # RabbitMQ payloads
  pkg/                        # shared libraries, owned by Agent 0
    config/  logging/  telemetry/  grpcx/  mq/  pg/  rediskeys/  driverstate/  geo/  idempotency/
  services/
    gateway/  ride/  location/  matching/  notification/
  migrations/                 # SQL (golang-migrate)
  deploy/
    docker-compose.yml  rabbitmq/definitions.json  redis/scripts/*.lua  prometheus/  otel/
  test/
    e2e/  load/  chaos/
  docs/                       # copy of HLD/LLD images and this plan
  Makefile  buf.yaml  buf.gen.yaml  go.work
```

**Ownership rule:** an agent edits only its own `services/<name>` directory. Changes to `proto/`, `pkg/`, `migrations/` or `deploy/rabbitmq` go through Agent 0 (open a request in `docs/contract-requests.md` or a PR tagged `contract-change`). This prevents agents breaking each other in parallel.

## 3. gRPC Contracts (`proto/`)

Package naming: `uber.<service>.v1`. All requests carry caller identity via metadata (`x-user-id`, `x-role`, `x-trace-id`, `x-idempotency-key`), set by the Gateway interceptor and read by services. Never put identity in the message body for authorization decisions.

### 3.1 common.proto

```proto
message LatLng { double lat = 1; double lng = 2; }
enum VehicleType { VEHICLE_TYPE_UNSPECIFIED = 0; ECONOMY = 1; PREMIUM = 2; XL = 3; }
message Money { int64 amount_minor = 1; string currency = 2; }
```

### 3.2 ride.proto: `RideService`

```proto
service RideService {
  // rider-facing (called by Gateway)
  rpc EstimateFare(EstimateFareRequest) returns (EstimateFareResponse);
  rpc RequestRide(RequestRideRequest) returns (RequestRideResponse);
  rpc GetRide(GetRideRequest) returns (Ride);
  rpc CancelRide(CancelRideRequest) returns (Ride);
  // driver-facing (called by Gateway)
  rpc SetDriverStatus(SetDriverStatusRequest) returns (SetDriverStatusResponse); // ONLINE/OFFLINE
  rpc RespondToOffer(RespondToOfferRequest) returns (RespondToOfferResponse);   // accept/decline
  rpc UpdateRideStatus(UpdateRideStatusRequest) returns (Ride);                 // ARRIVED/IN_PROGRESS/COMPLETED
  // internal (called by Matching)
  rpc RecordOffer(RecordOfferRequest) returns (RecordOfferResponse);           // persist ride_offers row
  rpc ExpireOffer(ExpireOfferRequest) returns (ExpireOfferResponse);
  rpc FailMatching(FailMatchingRequest) returns (Ride);                         // -> NO_DRIVERS_FOUND
}
message EstimateFareRequest { LatLng source = 1; LatLng destination = 2; VehicleType vehicle_type = 3; }
message EstimateFareResponse {
  string estimate_id = 1; Money fare = 2; int32 distance_m = 3; int32 duration_s = 4;
  int32 eta_to_pickup_s = 5; double surge_multiplier = 6; google.protobuf.Timestamp expires_at = 7;
}
message RequestRideRequest { string estimate_id = 1; }          // idempotency key in metadata
message RequestRideResponse { string ride_id = 1; RideStatus status = 2; }
message RespondToOfferRequest { string ride_id = 1; string offer_id = 2; bool accept = 3; }
message RespondToOfferResponse { bool applied = 1; string reason = 2; } // e.g. OFFER_EXPIRED
enum RideStatus { RIDE_STATUS_UNSPECIFIED = 0; FARE_ESTIMATED = 1; REQUESTED = 2; MATCHING = 3;
  DRIVER_ASSIGNED = 4; DRIVER_EN_ROUTE = 5; ARRIVED = 6; IN_PROGRESS = 7; COMPLETED = 8;
  NO_DRIVERS_FOUND = 9; CANCELLED_BY_RIDER = 10; CANCELLED_BY_DRIVER = 11; EXPIRED = 12; }
```

(`Ride`, `RecordOffer*`, `FailMatching*`, etc. follow the DB schema in Section 5; Agent 0 writes the full file.)

### 3.3 location.proto: `LocationService`

```proto
service LocationService {
  rpc StreamLocations(stream LocationPing) returns (StreamLocationsSummary); // client streaming, from Gateway
  rpc UpdateLocation(LocationPing) returns (google.protobuf.Empty);          // unary fallback
  rpc GetNearbyDrivers(NearbyRequest) returns (NearbyResponse);              // called by Matching
  rpc GetDriverLocation(GetDriverLocationRequest) returns (DriverLocation);  // rider live view
}
message LocationPing { string driver_id = 1; LatLng position = 2; float heading = 3; float speed_mps = 4; int64 ts_ms = 5; }
message NearbyRequest { LatLng center = 1; int32 radius_m = 2; VehicleType vehicle_type = 3; int32 limit = 4;
                        repeated string exclude_driver_ids = 5; }
message NearbyResponse { repeated DriverCandidate candidates = 1; }
message DriverCandidate { string driver_id = 1; LatLng position = 2; int32 distance_m = 3; float rating = 4; float acceptance_rate = 5; }
```

### 3.4 gRPC conventions (all services, implemented once in `pkg/grpcx`)

- Every client call has a deadline: default 2s, estimate 4s, `GetNearbyDrivers` 300ms.
- Retry policy only for idempotent reads (`UNAVAILABLE`, max 2 attempts, backoff 50ms). Never auto-retry `RespondToOffer` or `RequestRide` without an idempotency key.
- Status code mapping: `INVALID_ARGUMENT` bad input, `NOT_FOUND`, `FAILED_PRECONDITION` (invalid state transition, expired estimate), `ALREADY_EXISTS` (active ride exists), `PERMISSION_DENIED`, `RESOURCE_EXHAUSTED` (rate limit/overload), `UNAVAILABLE`.
- Interceptors: recovery, tracing (propagate `traceparent`), logging, metrics, auth-metadata extraction, deadline propagation.
- Standard `grpc.health.v1` and server reflection enabled in dev.
- Services expose gRPC on `:9090` and metrics/health HTTP on `:8081`.

## 4. RabbitMQ Topology

All queues are **quorum queues**, durable, with `x-delivery-limit=5` and a dead-letter exchange `dlx` routing to `<queue>.dlq`. Publishers use **publisher confirms** and `persistent` delivery. Consumers use **manual ack**, `prefetch` configured per queue, and must be **idempotent** (check `event_id` against a `processed_events` Redis key with 24h TTL, or rely on state checks).

Definitions live in `deploy/rabbitmq/definitions.json` (Agent 0) and are loaded at broker start.

### 4.1 Exchanges

| Exchange | Type | Purpose |
| --- | --- | --- |
| `ride.requests` | `x-consistent-hash` | ride requests fanned across matching queues by geo cell |
| `ride.events` | topic | domain events (ride, offer lifecycle) |
| `matching.delay` | direct | publishes into TTL delay queues |
| `dlx` | direct | dead letters |

The consistent-hash exchange needs the `rabbitmq_consistent_hash_exchange` plugin (enabled in docker-compose). Publish with routing key = `geoCell` (H3 resolution 7 string); bind each queue with weight `1`.

### 4.2 Queues and bindings

| Queue | Bound to | Consumer | Notes |
| --- | --- | --- | --- |
| `matching.requests.0` ... `matching.requests.7` | `ride.requests` (weight 1) | Matching worker i | **single active consumer** per queue, so one cell is served by one worker in order. Start with N=8, configurable |
| `matching.events` | `ride.events`: `offer.responded`, `offer.timeout`, `match.deadline`, `ride.cancelled` | Matching (any worker) | handlers take a per-ride Redis lock |
| `notification.events` | `ride.events`: `offer.created`, `ride.assigned`, `ride.status.changed`, `ride.cancelled`, `ride.no_drivers` | Notification | fan-out to riders/drivers |
| `matching.delay.offer.15s` | `matching.delay` key `offer.15s` | none (TTL 15000 ms) | dead-letters to `ride.events` with routing key `offer.timeout` |
| `matching.delay.offer.10s` | key `offer.10s` | none (TTL 10000 ms) | same, used in widened-radius rounds |
| `matching.delay.deadline.60s` | key `deadline.60s` | none (TTL 60000 ms) | dead-letters to `ride.events` with key `match.deadline` |

Timers are therefore pure RabbitMQ: publish a small message into the matching delay queue, and it re-appears on `ride.events` when the TTL expires. Handlers must re-check state (was the offer already answered? is the ride already assigned?) and ignore stale timers.

### 4.3 Message envelope (protobuf `events.v1.Envelope`)

```proto
message Envelope {
  string event_id = 1;            // uuid, idempotency
  string type = 2;                // e.g. "ride.requested"
  google.protobuf.Timestamp occurred_at = 3;
  string trace_id = 4;
  string ride_id = 5;
  oneof payload {
    RideRequested ride_requested = 10;     // ride_id, rider_id, source, destination, vehicle_type, fare, requested_at_ms, geo_cell
    OfferCreated offer_created = 11;       // ride_id, offer_id, driver_id, expires_at, pickup, dropoff, fare
    OfferResponded offer_responded = 12;   // ride_id, offer_id, driver_id, accepted
    OfferTimeout offer_timeout = 13;       // ride_id, offer_id, driver_id
    MatchDeadline match_deadline = 14;     // ride_id
    RideAssigned ride_assigned = 15;       // ride_id, driver_id, rider_id, eta_s, driver_info
    RideStatusChanged ride_status_changed = 16; // ride_id, status, driver_id, rider_id
    RideCancelled ride_cancelled = 17;     // ride_id, by, driver_id
    RideNoDrivers ride_no_drivers = 18;    // ride_id, rider_id
  }
}
```

Routing keys equal the `type` field. Content type is `application/x-protobuf`.

### 4.4 Transactional outbox (Ride Service)

The Ride Service never publishes inside a DB transaction. It writes an `outbox` row in the same transaction as the state change. A relay goroutine polls (`SELECT ... FOR UPDATE SKIP LOCKED LIMIT 100`), publishes with confirms, then marks the row sent. This guarantees `ride.requested` is published if and only if the ride was committed (at-least-once, consumers are idempotent).

## 5. Data Contracts

### 5.1 PostgreSQL (`migrations/0001_init.sql`, owned by Agent 0)

```sql
CREATE TYPE driver_status AS ENUM ('OFFLINE','AVAILABLE','RESERVED','IN_RIDE');
CREATE TYPE ride_status AS ENUM ('FARE_ESTIMATED','REQUESTED','MATCHING','DRIVER_ASSIGNED','DRIVER_EN_ROUTE',
  'ARRIVED','IN_PROGRESS','COMPLETED','NO_DRIVERS_FOUND','CANCELLED_BY_RIDER','CANCELLED_BY_DRIVER','EXPIRED');
CREATE TYPE offer_status AS ENUM ('PENDING','ACCEPTED','DECLINED','EXPIRED');

CREATE TABLE riders  (id uuid PRIMARY KEY, name text, phone text, email text, device_token text, created_at timestamptz DEFAULT now());
CREATE TABLE drivers (id uuid PRIMARY KEY, name text, phone text, vehicle_type text, vehicle_no text, rating real DEFAULT 5,
  acceptance_rate real DEFAULT 1, status driver_status NOT NULL DEFAULT 'OFFLINE', current_ride_id uuid,
  version bigint NOT NULL DEFAULT 0, device_token text);
CREATE TABLE fare_estimates (id uuid PRIMARY KEY, rider_id uuid NOT NULL, src_lat double precision, src_lng double precision,
  dst_lat double precision, dst_lng double precision, vehicle_type text, distance_m int, duration_s int,
  fare_minor bigint, currency char(3), surge_multiplier numeric(4,2), expires_at timestamptz NOT NULL);
CREATE TABLE rides (id uuid PRIMARY KEY, rider_id uuid NOT NULL, driver_id uuid, fare_estimate_id uuid NOT NULL,
  src_lat double precision, src_lng double precision, dst_lat double precision, dst_lng double precision,
  geo_cell text NOT NULL, fare_minor bigint, currency char(3), eta_s int, status ride_status NOT NULL,
  idempotency_key text UNIQUE, requested_at timestamptz, matched_at timestamptz, started_at timestamptz,
  completed_at timestamptz, version bigint NOT NULL DEFAULT 0);
CREATE TABLE ride_offers (id uuid PRIMARY KEY, ride_id uuid NOT NULL, driver_id uuid NOT NULL, status offer_status NOT NULL,
  offered_at timestamptz, expires_at timestamptz, responded_at timestamptz);
CREATE TABLE outbox (id bigserial PRIMARY KEY, event_id uuid UNIQUE, routing_key text, exchange text, body bytea,
  created_at timestamptz DEFAULT now(), sent_at timestamptz);

CREATE INDEX ON rides (rider_id, status);
CREATE INDEX ON rides (driver_id, status);
CREATE INDEX ON ride_offers (ride_id);
CREATE INDEX ON outbox (id) WHERE sent_at IS NULL;
CREATE UNIQUE INDEX one_active_ride_per_driver ON rides (driver_id)
  WHERE status IN ('DRIVER_ASSIGNED','DRIVER_EN_ROUTE','ARRIVED','IN_PROGRESS');
CREATE UNIQUE INDEX one_active_ride_per_rider ON rides (rider_id)
  WHERE status IN ('REQUESTED','MATCHING','DRIVER_ASSIGNED','DRIVER_EN_ROUTE','ARRIVED','IN_PROGRESS');
```

### 5.2 Redis keys (`pkg/rediskeys`, owned by Agent 0)

| Key | Type | TTL | Owner(s) |
| --- | --- | --- | --- |
| `geo:drivers:{region}:{vehicleType}` | GEO (sorted set) | none; members removed on reserve/offline | Location (add), driverstate (remove) |
| `driver:loc:{driverId}` | hash lat,lng,heading,speed,ts | 15s | Location |
| `driver:state:{driverId}` | hash status,rideId,region,vehicleType | reservation TTL only while RESERVED | driverstate |
| `ride:tried:{rideId}` | set of driverIds | 10 min | Matching |
| `ride:lock:{rideId}` | string (lock) | 5s | Matching |
| `ride:match:{rideId}` | hash round, radius, currentOffer | 10 min | Matching |
| `processed:{eventId}` | string | 24h | all consumers |
| `surge:{geoCell}` | string multiplier | 60s | Ride (read) / surge job (write) |

`region` is derived from H3 resolution 4 of the point. `geoCell` is H3 resolution 7.

### 5.3 Shared package `pkg/driverstate` (the heart of consistency)

This package wraps Lua scripts (`deploy/redis/scripts/*.lua`, embedded with `go:embed`). It is the **only** code allowed to change `driver:state:*` and the GEO available set.

```go
type Store interface {
  GoOnline(ctx, driverID, region, vt, pos) error          // OFFLINE -> AVAILABLE, GEOADD
  GoOffline(ctx, driverID) error                           // any non-IN_RIDE -> OFFLINE, ZREM
  TryReserve(ctx, driverID, rideID, ttl time.Duration) (bool, error) // AVAILABLE -> RESERVED, ZREM, EXPIRE
  Release(ctx, driverID, rideID) error                    // RESERVED(ride) -> AVAILABLE, GEOADD back using last loc
  Confirm(ctx, driverID, rideID) (bool, error)            // RESERVED(ride) -> IN_RIDE, PERSIST (remove TTL)
  Complete(ctx, driverID, rideID) error                   // IN_RIDE(ride) -> AVAILABLE, GEOADD
}
```

Every transition checks both current status and `rideId` ownership inside the Lua script, so late or duplicate calls become harmless no-ops (return false).

## 6. Cross-Cutting Rules (all agents)

1. **State changes are conditional.** Ride/driver updates use `WHERE id=? AND status=? AND version=?`. Zero rows updated means the transition is rejected (return `FAILED_PRECONDITION`).
2. **Handlers are idempotent.** Re-delivery of any RabbitMQ message or retry of any gRPC call must not change the outcome.
3. **Ack after commit.** Consumers ack only after DB/Redis effects succeed; on transient error `nack` with requeue (bounded by delivery limit), on poison message `reject` to DLQ.
4. **Config via env** (12-factor): `PG_DSN`, `REDIS_ADDR`, `AMQP_URL`, `GRPC_ADDR`, `RIDE_SVC_ADDR`, `LOCATION_SVC_ADDR`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `MATCH_DEADLINE_S=60`, `OFFER_TTL_S=15`, `MATCH_RADII_M=1000,2000,4000,6000`, `MATCH_QUEUE_COUNT=8`.
5. **Time budget:** matching must finish or fail within `MATCH_DEADLINE_S`; every blocking call takes a context with a deadline.
6. **Logging:** JSON logs always include `trace_id`, `ride_id`, `driver_id` where known.
7. **Metrics (Prometheus):** each service exposes request counts and latency histograms; plus those listed in each work package.
8. **Testing:** unit tests for logic, integration tests with `testcontainers-go` (Postgres, Redis, RabbitMQ). A package is not done without tests meeting its acceptance criteria.
9. **No cross-service DB access.** Only the Ride Service touches Postgres. Only `pkg/driverstate` and the Location Service touch the driver Redis keys.
10. **Fakes for parallel work:** Agent 0 publishes in-memory fakes (`pkg/testing/fakes`) for `RideServiceClient`, `LocationServiceClient`, `MappingClient`, and `mq.Publisher` so agents do not block each other.

## 7. Execution Order and Milestones

```
Phase 0  Agent 0 (Foundation)            --> blocks everyone, ship first
Phase 1  Agents 1,2,3,4,5 in parallel    --> each against fakes + real infra
Phase 2  Integration (Agent 6) + fixes   --> end-to-end, concurrency, load
Phase 3  Surge features (batch matching, surge pricing), hardening
```

| Milestone | Definition |
| --- | --- |
| M0 | `make up` starts infra; `buf generate` compiles; migrations apply; RabbitMQ definitions loaded; fakes available |
| M1 | Estimate flow works end-to-end: app call to Gateway to Ride Service to Mapping fake, returns fare |
| M2 | Happy path: request ride, driver gets offer, accepts, rider notified (single driver, single ride) |
| M3 | Failure paths: decline, timeout, no drivers, cancel, worker crash, duplicate messages |
| M4 | Concurrency proof: 1000 riders vs 20 drivers in one cell produces zero double assignments |
| M5 | Load targets met (Section 9) and dashboards live |

## 8. Work Packages

### Agent 0: Foundation, Contracts and Infra

**Deliver:**

- Monorepo skeleton, `go.work`, Makefile targets: `up`, `down`, `proto`, `migrate`, `test`, `lint`, `e2e`, `load`.
- All `.proto` files from Section 3 completed; `buf` lint and breaking-change checks; generated Go code committed or generated in CI.
- `deploy/docker-compose.yml`: Postgres, Redis, RabbitMQ (management + consistent-hash plugin), Jaeger, Prometheus, Grafana.
- `deploy/rabbitmq/definitions.json` implementing Section 4 exactly (exchanges, N queues, bindings, TTL queues, DLQs, quorum + delivery limit).
- `migrations/` from Section 5.1, plus seed script (100 riders, 500 drivers).
- `pkg/`: `config`, `logging`, `telemetry`, `grpcx` (interceptors, deadlines, health), `mq` (publisher with confirms, consumer with manual ack, retry/DLQ helpers, envelope helpers), `pg`, `rediskeys`, `geo` (H3 helpers, haversine), `idempotency`.
- `pkg/driverstate` with all Lua scripts and unit tests (including a parallel test where 100 goroutines call `TryReserve` for one driver and exactly one wins).
- Fakes for client interfaces (Section 6, rule 10).
- `docs/` with the HLD/LLD images and this plan.

**Acceptance:** M0. `go test ./pkg/...` passes; `driverstate` race test passes with `-race`; RabbitMQ: a message published to `matching.delay.offer.15s` appears on `matching.events` after \~15s in an integration test.

### Agent 1: Ride Service (`services/ride`)

**Responsibilities:** fare estimation, ride lifecycle, only owner of Postgres, outbox relay, offer response handling.

**Deliver:**

1. gRPC server implementing `RideService`.
2. `FareCalculator` (base + per km + per min, times surge, minimum fare) with table-driven tests; `MappingClient` interface with HTTP implementation, cache by rounded source/destination geohash + 5 min bucket, circuit breaker, haversine fallback marked `approximate`.
3. `EstimateFare`: validate coordinates and service area, call mapping, read `surge:{geoCell}` from Redis (default 1.0), insert `fare_estimates` with 5 min expiry.
4. `RequestRide`: honour `x-idempotency-key` (return existing ride if key exists); verify estimate ownership and expiry (`FAILED_PRECONDITION`); insert ride as `REQUESTED` then `MATCHING`; write `ride.requested` outbox row (exchange `ride.requests`, routing key = `geo_cell`) and a `match.deadline` timer message (`matching.delay` key `deadline.60s`) in the same transaction; return immediately.
5. `RespondToOffer`: check offer is `PENDING` and not expired. Decline: mark offer `DECLINED`, publish `offer.responded(accepted=false)`. Accept: transaction (a) `UPDATE drivers ... status='IN_RIDE'` with version/status check, (b) `UPDATE rides SET driver_id, status='DRIVER_ASSIGNED' WHERE status='MATCHING'`, (c) offer `ACCEPTED`, (d) outbox `ride.assigned`; after commit call `driverstate.Confirm`. If the DB transaction fails, call `driverstate.Release` and return `applied=false`.
6. `UpdateRideStatus` (driver-only, ownership check): ARRIVED, IN\_PROGRESS, COMPLETED with state-machine validation. On COMPLETED call `driverstate.Complete` and set driver `AVAILABLE` in DB. Publish `ride.status.changed`.
7. `CancelRide`: rider cancel before pickup releases the driver (DB + `driverstate.Release`/`Complete`), publishes `ride.cancelled`. Driver cancel returns the ride to `MATCHING` with the old driver excluded and republishes `ride.requested`.
8. `SetDriverStatus`: ONLINE/OFFLINE via `driverstate.GoOnline/GoOffline` + DB (reject OFFLINE while IN\_RIDE).
9. Internal RPCs `RecordOffer`, `ExpireOffer`, `FailMatching` (sets `NO_DRIVERS_FOUND`, publishes `ride.no_drivers`).
10. Outbox relay with confirms; metrics `outbox_lag_seconds`, `ride_state_transition_total{from,to}`.

**Acceptance:** unit tests for every state transition (valid and invalid); integration test for the accept transaction including the unique partial indexes; test that a duplicate `RequestRide` with the same idempotency key returns the same ride and one outbox row; outbox relay survives broker restart without losing events.

### Agent 2: Location Service (`services/location`)

**Responsibilities:** high-volume driver location ingest and proximity queries over Redis.

**Deliver:**

1. gRPC `StreamLocations` (client streaming, batches acked by summary) and unary `UpdateLocation`.
2. Ingest logic: drop out-of-order pings (`ts_ms` older than stored), write `driver:loc:{id}` with 15s TTL; if `driver:state` is AVAILABLE, `GEOADD` into `geo:drivers:{region}:{vehicleType}`; if IN\_RIDE only write the hash. Use Redis pipelining/batching (flush every 50 ms or 200 pings).
3. `GetNearbyDrivers`: `GEOSEARCH BYRADIUS ... ASC COUNT limit*2`, filter members without a live `driver:loc` key (stale; also `ZREM` them), apply `exclude_driver_ids`, enrich with rating and acceptance rate (read from a Redis hash `driver:meta:{id}` populated by the Ride Service on status change, cached in-process for 60s), return up to `limit`.
4. `GetDriverLocation` for the rider's live view.
5. A background sweeper that removes GEO members whose `driver:loc` expired.
6. Metrics: `location_pings_total`, `location_ingest_latency`, `nearby_query_latency`, `stale_drivers_removed_total`.

**Acceptance:** `GetNearbyDrivers` returns drivers sorted by distance and never returns RESERVED or IN\_RIDE drivers; p99 of `GetNearbyDrivers` under 20 ms at 10k drivers locally; ingest sustains 20k pings/s on one instance in the load test; out-of-order ping test.

### Agent 3: Ride Matching Service (`services/matching`)

**Responsibilities:** consume ride requests, search, rank, reserve atomically, offer, handle responses and timers, enforce the 60s deadline.

**Deliver:**

1. Consumers: `matching.requests.<i>` (single active consumer, worker index from env `WORKER_QUEUES`), and `matching.events` (any worker).
2. On `ride.requested`: check ride still `MATCHING` (via `GetRide`), initialize `ride:match:{id}` (round 0, radius 1000), start the matching loop `offerToNext(ride)`.
3. `offerToNext`:
   - acquire `ride:lock:{id}` (SET NX PX 5000) for the handler duration;
   - get candidates via `LocationService.GetNearbyDrivers` (excluding `ride:tried`);
   - rank: ETA (distance/average speed, mapping ETA only for the top 5 via a pluggable `EtaProvider`), then rating, then acceptance rate;
   - for each candidate in order: `driverstate.TryReserve(driver, ride, 15s)`; on false try next; on true `RecordOffer` (gRPC), add to `ride:tried`, publish `offer.created` and a delay message `offer.15s` (carrying offer\_id and driver\_id), then stop;
   - no candidates in this radius: move to the next radius in `MATCH_RADII_M`; if all radii are exhausted, re-search every 5s (via a delay message) until the deadline instead of busy-looping.
4. On `offer.responded(accepted=false)` or `offer.timeout` (check offer still pending): `driverstate.Release`, `ExpireOffer` for timeouts, then `offerToNext`. On `offer.responded(accepted=true)`: stop the loop (Ride Service already confirmed); clean up keys.
5. On `ride.cancelled`: if an offer is pending, `Release` the driver and clean up.
6. On `match.deadline`: if the ride is still `MATCHING`, release any pending reservation and call `FailMatching`.
7. Discard stale or duplicate messages using `processed:{eventId}` and state checks.
8. **Surge mode (Phase 3):** per-cell pending set; when pending rides exceed available drivers, run windowed batch assignment every 1-2s (greedy by pickup ETA, Hungarian optional) and offer each pair through the same `TryReserve` path.
9. Metrics: `match_latency_seconds`, `match_success_total`, `match_failure_total`, `offers_per_ride`, `reserve_conflicts_total`, `queue_depth`.

**Acceptance:** with fakes: decline then second driver accepts; all drivers decline then deadline fails the ride; reserve conflict skips to next driver; crash mid-offer (kill worker, restart) still resolves via TTL and timers; duplicate `ride.requested` does not create two offers; handler never calls `TryReserve` without holding the ride lock.

### Agent 4: Notification and Realtime Service (`services/notification`)

**Responsibilities:** deliver offers and ride updates to the apps.

**Deliver:**

1. Consumer on `notification.events` with per-event handlers:
   - `offer.created` to driver (high-priority push + WebSocket), drop if `expires_at` passed;
   - `ride.assigned` to rider (driver details, ETA) and driver (pickup point);
   - `ride.status.changed`, `ride.cancelled`, `ride.no_drivers` to the right party.
2. WebSocket endpoint `/realtime` (authenticated by the Gateway, which passes `x-user-id` and `x-role`): connection registry (`user_id` to connections), heartbeat/ping every 20s, reconnect with `last_event_id` replay from a small Redis stream per user (last 50 events, 10 min).
3. Push provider abstraction `PushSender` (APNs, FCM) with fakes. Fallback: if no live socket, send push; retry with backoff for non-offer messages only.
4. Live driver location relay to the rider during an active ride (Redis pub/sub channel written by the Location Service, 1 update per 4s).
5. Scales horizontally: Redis pub/sub channel per user so any instance can deliver to the instance holding the socket.
6. Metrics: `notifications_sent_total{channel,type}`, `ws_connections`, `offer_delivery_latency_seconds`.

**Acceptance:** offer reaches a connected driver socket in under 300 ms after publish in the integration test; expired offers are not delivered; reconnect replays missed events; push fallback used when no socket.

### Agent 5: API Gateway (`services/gateway`)

**Responsibilities:** public REST + WebSocket edge, auth, rate limiting, translation to gRPC.

**Deliver:**

1. REST endpoints per the LLD: `POST /v1/rides/estimate`, `POST /v1/rides`, `GET /v1/rides/{id}`, `POST /v1/rides/{id}/cancel`, `POST /v1/drivers/me/status`, `PUT /v1/drivers/me/location`, `POST /v1/rides/{id}/offer-response`, `POST /v1/rides/{id}/status`. Handlers translate JSON to gRPC and gRPC status to HTTP (`FAILED_PRECONDITION` 409/410, `RESOURCE_EXHAUSTED` 429, etc.).
2. JWT validation middleware (HS256 for dev, JWKS-ready), role checks (rider vs driver), and a dev-only `/v1/dev/token` issuer.
3. Rate limiting (Redis token bucket): per user and per IP, higher limit for location pings, per-geo-cell cap on `POST /v1/rides` to protect against surges.
4. `Idempotency-Key` header required on `POST /v1/rides`, forwarded as gRPC metadata.
5. Location ingest path: gRPC client stream to Location Service (batching per gateway instance), unary fallback for plain REST pings.
6. WebSocket `/v1/realtime`: validate JWT, then reverse-proxy to the Notification Service.
7. Load balancing across service instances using gRPC client-side round-robin with DNS or static endpoints.
8. OpenAPI spec `docs/openapi.yaml` kept in sync with handlers.

**Acceptance:** contract tests against OpenAPI; a rider token cannot call driver endpoints; rate limit returns 429 with `Retry-After`; end-to-end estimate request round-trips in under 150 ms excluding mapping.

### Agent 6: Integration, Load and Chaos (`test/`)

**Deliver:**

1. **E2E scenarios** (Go tests over the real Gateway): estimate to ride to accept to complete; decline then accept; all decline then `NO_DRIVERS_FOUND` (use `MATCH_DEADLINE_S=6` in tests); rider cancel mid-offer; driver cancel after accept returns to matching.
2. **Consistency test:** 1000 concurrent `RequestRide` calls and 20 online drivers in the same geo cell, drivers auto-accept after a random 0-3s. Assert: no driver appears in two active rides at any time (query DB for violations every second), every ride ends in a terminal or active state, and `reserve_conflicts_total` is greater than 0.
3. **Chaos tests:** kill Matching mid-offer; restart RabbitMQ; wipe Redis driver state (confirm the DB conditional update still blocks double assignment); duplicate-publish `ride.requested`.
4. **Load tests** (`ghz` for gRPC, `k6` for REST/WebSocket): location ingest, `GetNearbyDrivers`, 100k ride-request burst from one location with rate limiting enabled, match latency distribution.
5. Grafana dashboards: match latency p50/p95/p99, success rate, queue depth per matching queue, outbox lag, reserve conflicts, ingest rate.
6. Invariant checker script `test/invariants.sql` (drivers with more than one active ride, rides stuck in MATCHING past deadline + 5s, RESERVED drivers without a pending offer older than 30s).

**Acceptance:** M3, M4 and M5 criteria from Section 7.

## 9. Non-Functional Targets and How They Are Verified

| Requirement | Target | Verified by |
| --- | --- | --- |
| Match or fail | <= 60s (hard); typical first-driver accept < 5s in tests | E2E + `match_latency_seconds` |
| Strong consistency | zero drivers with 2 active rides | Consistency test + invariant script + DB unique index |
| Peak throughput | 100k requests from one location handled without crashing; excess gets 429 or `NO_DRIVERS_FOUND` | k6 burst test, queue depth stays bounded, no message loss |
| Location ingest | >= 20k pings/s per Location instance | ghz test |
| Nearby query | p99 < 20 ms at 10k drivers | Benchmark |
| Offer delivery | < 300 ms from `offer.created` to socket | Notification integration test |

## 10. Hand-off Prompt Template (give this to each agent)

> You are implementing **\<Agent N: name>** of the Uber clone. Read `docs/AGENT_PLAN.md` Sections 1-7 and your work package in Section 8. Use only the contracts in `proto/`, the RabbitMQ topology in Section 4, the schema in Section 5 and the shared `pkg/` libraries. Edit only `services/<name>`. If a contract is missing or wrong, write the problem and your proposed change in `docs/contract-requests.md` and continue with a fake or stub instead of editing shared files. Develop against the provided fakes first, then against real infra with `make up`. Deliver code, unit and integration tests, metrics, and a short `services/<name>/README.md` (how to run, env vars, design notes). Finish only when every acceptance criterion in your work package passes (`make test` plus the listed scenarios) and report which criteria you verified and how.

## 11. Risks and Notes for Reviewers

- **RabbitMQ ordering:** per-queue ordering plus single active consumer gives per-cell ordering. If the queue count N changes, in-flight rides may move cells; handlers must not rely on ordering for correctness, only for efficiency.
- **TTL queues:** RabbitMQ only expires messages at the head of a queue. Because all messages in each delay queue share the same TTL, ordering is preserved and this is safe; never mix TTLs in one queue.
- **Consistent-hash rebalancing** when adding queues remaps some cells; plan such changes for low traffic.
- **Redis is a fast path, not the source of truth.** The DB conditional updates and the unique partial indexes are the final guard. A reconciliation job (Phase 3) repairs drift between `driver:state` and `drivers.status`.
- **Mapping API cost and latency:** keep estimates cached and ETAs approximate for the candidate list; call the mapping API only for the top few.
- **Open decisions to confirm before coding:** language (Go assumed), H3 resolutions (4 for region, 7 for cell), push provider accounts, and whether the apps will use gRPC-Web directly later (the design keeps the Gateway as the only public edge for now).
