# Uber Clone: Service-by-Service Implementation Plan

Build one service at a time, finish it completely, then move to the next: 8 steps, about 8-10 weeks for one small team. Each service is tested on its own with scripts and fakes, so you never debug five half-built services together.

## Overview

| Step | Service | Depends on | Rough time | You can demo |
| --- | --- | --- | --- | --- |
| 0 | Foundation (contracts, infra, shared code) | nothing | 1 week | `make up` starts everything locally |
| 1 | Location Service | Foundation | 1 week | Drivers send pings, nearby search works |
| 2 | Ride Service | Foundation, Location (for driver state) | 2 weeks | Estimate, request, accept, trip lifecycle via scripts |
| 3 | Ride Matching Service | Ride, Location | 2 weeks | Request a ride, a driver gets an offer and is assigned |
| 4 | Notification Service | Foundation, events from Ride and Matching | 1 week | Offer reaches a driver socket; rider sees updates |
| 5 | API Gateway | all services | 1 week | Real app-style REST and WebSocket calls |
| 6 | End-to-end, failures, load | everything | 1-2 weeks | Crash, decline and burst tests pass |
| 7 | Hardening | everything | 1 week | Dashboards, alerts, security, runbooks |

## Working Rules

- **Freeze the contract first.** The gRPC `.proto` files, RabbitMQ setup and database schema are fixed in Step 0. Changing them later goes through one owner.
- **One service at a time.** Do not start the next step until the current one meets its "Done when" list.
- **Each service lives alone** in `services/<name>` with its own README, tests and run command.
- **Test without the others.** Use `grpcurl` for gRPC, the RabbitMQ management page for events, and fakes for any service not built yet.
- **Every step ends with a demo script** that shows the service working, committed to the repo.

## Step 0: Foundation (1 week)

**Purpose:** everything the services share, so none of them has to invent it.

**Build, in order**

1. Repo layout, CI (lint, test, build) and a Makefile (`up`, `down`, `proto`, `migrate`, `test`).
2. All `.proto` files and event message definitions; code generation.
3. Database migrations, including the rule that one driver can have only one active ride.
4. docker-compose: PostgreSQL, Redis, RabbitMQ, tracing and metrics tools.
5. RabbitMQ setup file: exchanges, matching queues, event queues, timer queues, dead-letter queues.
6. Shared libraries: config, logging, tracing, gRPC helpers, RabbitMQ helpers, Redis key names, geo helpers.
7. Driver-state library with Redis scripts: go online, go offline, reserve, release, confirm, complete.
8. Fake clients and a seed script (sample riders and drivers).

**Done when:** `make up` works, migrations apply, generated code compiles, a message sent to a timer queue returns after its delay, and exactly one of 100 parallel reserve attempts on the same driver wins.

## Step 1: Location Service (1 week)

**Purpose:** know where available drivers are. It needs only Redis, so it is the safest first service.

**Build, in order**

1. Server skeleton with health check, config and metrics.
2. Accept a driver ping and store the latest position with a 15-second expiry; ignore out-of-order pings.
3. If the driver is available, add them to the geo index; if on a ride, only store the position.
4. Streaming ping call for high volume, with batching.
5. "Drivers near this point" search: sorted by distance, filters out stale drivers, supports an exclude list and a limit.
6. Driver location lookup for the rider's live view.
7. Background cleanup of expired drivers.

**Test alone:** a script that creates 10,000 fake drivers moving around and runs searches.

**Done when:** search returns only available drivers, sorted by distance; search is under 20 ms at 10,000 drivers; one instance handles 20,000 pings per second; stale drivers disappear within 15 seconds.

**Hands over to next steps:** the `GetNearbyDrivers` call used by Matching.

## Step 2: Ride Service (2 weeks)

**Purpose:** the owner of ride data and ride rules. It is the only service that writes to PostgreSQL. Build it in three slices.

**Slice A: estimate and driver status (days 1-4)**

1. Fare calculator with unit tests (base, per km, per minute, surge, minimum).
2. Mapping client with cache, timeout, circuit breaker and a distance-based fallback.
3. `EstimateFare`: saves the estimate with a 5-minute expiry.
4. `SetDriverStatus`: online and offline, using the driver-state library.

**Slice B: request a ride (days 5-8)**

1. `RequestRide` with idempotency key: checks the estimate, blocks a second active ride for the same rider, saves the ride as MATCHING.
2. Outbox: the ride-requested event and the 60-second deadline timer are saved in the same transaction; a sender publishes them to RabbitMQ.
3. Internal calls for Matching: `RecordOffer`, `ExpireOffer`, `FailMatching`.
4. `GetRide`.

**Slice C: accept, trip and cancel (days 9-14)**

1. `RespondToOffer`: decline marks the offer and publishes an event; accept runs one database transaction that assigns the driver and ride, then confirms the reservation and publishes the assigned event.
2. `UpdateRideStatus`: arrived, in progress, completed, with rule checks; driver becomes available on completion.
3. `CancelRide` for rider and driver, including returning the ride to matching after a driver cancel.

**Test alone:** a script plays the Matching Service (reserves a driver, calls `RecordOffer`) and a script plays the driver (accepts); watch events on RabbitMQ.

**Done when:** every valid and invalid state change is tested; accepting twice or accepting after expiry is rejected; a repeated `RequestRide` with the same key creates one ride and one event; the outbox keeps working through a RabbitMQ restart.

**Hands over to next steps:** the events `ride.requested`, `offer.created` (published by Matching), `ride.assigned`, `ride.status.changed`, `ride.cancelled`, `ride.no_drivers`.

## Step 3: Ride Matching Service (2 weeks)

**Purpose:** find a driver fast and never assign one driver twice. Now the Location and Ride services are real, so this is built against the real thing.

**Build, in order**

1. Consumers: the matching queues (one worker per queue) and the shared events queue.
2. On a ride request: confirm the ride is still MATCHING; set up its matching state in Redis.
3. Candidate search through the Location Service, excluding drivers already tried.
4. Ranking: pickup time estimate first, then rating, then acceptance rate.
5. Reserve the first driver with the atomic reserve call, record the offer, publish the offer event, start the 15-second offer timer. If the reserve fails, move to the next candidate.
6. Handle decline and timer expiry: release the driver and offer to the next one.
7. Widen the search radius in steps (1, 2, 4, 6 km); when nothing is left, retry every 5 seconds until the deadline.
8. Handle the deadline timer: if still unmatched, call `FailMatching`.
9. Handle cancellation and duplicate or stale messages.

**Test alone:** run it with the real Location and Ride services and scripted drivers; also run it with fakes to force unusual cases.

**Done when:** decline then second driver accepts; all drivers decline then the ride fails at the deadline; a reserve conflict skips to the next driver; killing a worker mid-offer still ends cleanly; a duplicate request creates one offer.

**Hands over to next steps:** the `offer.created` event the Notification Service delivers.

## Step 4: Notification Service (1 week)

**Purpose:** get offers and updates to the apps quickly.

**Build, in order**

1. Consumer on the notification events queue.
2. WebSocket endpoint with a connection list per user, heartbeat, and a short replay of missed events after reconnect.
3. Offer delivery to the driver; skip offers that have already expired.
4. Assigned, status, cancelled and no-drivers messages to the right rider or driver.
5. Push notification fallback (APNs and FCM, with fakes first) when no live socket exists.
6. Live driver location relay to the rider during a ride.
7. Support several instances (a Redis channel per user so any instance can deliver).

**Test alone:** open test WebSocket clients, publish events by hand into RabbitMQ, and check what each client receives.

**Done when:** a connected driver gets an offer within 300 ms of the event; expired offers are never sent; a reconnecting client receives what it missed; push is used when there is no socket.

## Step 5: API Gateway (1 week)

**Purpose:** the single public door. It is thin because all the logic is already in the services.

**Build, in order**

1. REST routes that call the gRPC services and map errors to HTTP codes.
2. Login token (dev issuer first), role checks for rider and driver.
3. Rate limits per user, per IP and per area for ride requests.
4. `Idempotency-Key` handling on ride requests.
5. Location ping path using the streaming call, with a plain REST fallback.
6. WebSocket proxy to the Notification Service.
7. API description file (OpenAPI) kept in step with the routes.

**Test alone:** API contract tests; a rider token must fail on driver routes; limits return 429.

**Done when:** every route in the LLD works through the gateway, the rate limits work, and an estimate request answers in under 150 ms excluding the mapping provider.

## Step 6: End-to-End, Failures and Load (1-2 weeks)

**Purpose:** prove the whole system works together and meets the requirements.

**Do, in order**

1. Full journey test: estimate, request, offer, accept, arrive, start, complete.
2. Failure tests: decline, timeout, no drivers, cancel by rider, cancel by driver, duplicate messages.
3. Crash tests: stop Matching mid-offer, restart RabbitMQ, clear Redis driver state.
4. Consistency test: 1,000 riders and 20 drivers in one area; no driver may ever have two active rides.
5. Load tests: pings, searches, ride-request bursts (100k from one place), WebSocket connections.
6. Add batch matching (every 1-2 seconds when requests outnumber drivers) and surge pricing if the load tests need them.
7. Tune RabbitMQ queue count, prefetch and worker counts.

**Done when:** all scenarios pass, zero double assignments, the burst test finishes without crashes or lost messages, and match-or-fail stays within 60 seconds.

## Step 7: Hardening (1 week)

- Dashboards and alerts: match time, success rate, queue depth, outbox delay, any double assignment.
- Security: real token keys, ownership checks on every action, TLS between services, GPS sanity checks.
- Reconciliation job: fix differences between Redis driver state and the database.
- Backups, failover tests, runbooks, staging environment and rollback steps.

**Done when:** staging passes the full suite plus a crash test, and alerts and runbooks have been tested.

## Why This Order

- Location comes first because it needs only Redis and gives Matching its search.
- Ride Service comes before Matching because Matching needs its offer and ride-state calls.
- Notification comes after the events exist, so it can be built against real events.
- The Gateway is last because it only translates calls; building it earlier would mean rewriting it as services change.

## Risks

- **Matching correctness** is the biggest risk; keep all three guards (Redis reserve, database conditional update, unique index).
- **A hot area** can overload one worker; try a single-location burst already in Step 3, not only in Step 6.
- **Mapping provider** cost and speed; cache results and use approximate times for ranking.
- **Contract drift:** only the Foundation owner changes shared contracts.
