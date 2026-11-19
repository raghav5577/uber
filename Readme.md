# Uber Clone Microservices System

A distributed ride-hailing microservices backend simulating the core architecture and ride lifecycle of Uber. Built with Node.js (Express 5), Redis 7 (Geospatial indexing & state), and PostgreSQL / Supabase (relational ride state machine).

---

## Architecture Overview

```
                                      [ Mobile Apps / Frontend ]
                                                   │
                                                   ▼
                                        [ API Gateway : 3000 ]
                                 (JWT Auth, Rate Limiting, Proxying)
                                                   │
                       ┌───────────────────────────┼───────────────────────────┐
                       ▼                           ▼                           ▼
            [ Location Service : 3003 ]  [ Ride Service : 3001 ]  [ Matching Service : 3002 ]
              (Driver GPS Telemetry)      (Fares & State Machine)      (Offer Dispatch Loop)
                       │                           │                           │
                       ▼                           ▼                           ▼
                 [ Redis 7 ]             [ PostgreSQL / Supabase ]           [ Redis 7 ]
             (GEO Index & Alive TTL)     (Drivers & Rides Schema)      (Offer Locks & Declines)
```

---

## Services & Ports

| Service | Port | Datastore | Responsibilities | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Location Service** | `3003` | Redis 7 | Ingests GPS pings (`POST /drivers/location`), manages 30s heartbeat TTL, provides radius-based driver searches (`GET /internal/drivers/nearby`). | **Completed & Verified** |
| **Ride Service** | `3001` | PostgreSQL (Supabase) | Source of truth for relational records, fare quotes (`POST /fare`), ride requests (`POST /rides`), ride state transitions (`accepted`, `completed`), driver status. | **Completed** |
| **Matching Service** | `3002` | Redis 7 | Dispatches 15s driver offers, manages atomic offer locks, tracks declines, expands search radius when drivers decline or time out. | *Pending* |
| **API Gateway** | `3000` | None | Public gateway verifying JWTs, enforcing rate limits, and reverse-proxying requests to internal microservices. | *Pending* |

---

## Tech Stack
* **Runtime**: Node.js (Express 5)
* **In-Memory Store**: Redis 7 Alpine (`GEOADD`, `GEOSEARCH`, TTL heartbeats, atomic locks)
* **Relational Database**: PostgreSQL 16 (Hosted on Supabase or local Docker)
* **Authentication**: Role-based access control (RBAC) via Gateway headers (`x-user-id`, `x-user-role`, `x-internal-key`)
* **Containerization**: Docker Compose

---

## Key Business & Concurrency Rules Implemented
1. **Partial Unique Index (`one_open_ride_per_driver`)**: Guarantees at the database level that no driver can hold more than one active ride concurrently.
2. **Atomic Driver Status**: A driver driving a passenger (`inRide`) cannot manually switch to `offline` or `available`.
3. **Heartbeat Pruning**: Drivers who close the app or lose connection are automatically pruned from searches within 30 seconds.
4. **Row Level Security (RLS)**: Public tables in Supabase are locked against unauthorized external API calls.
