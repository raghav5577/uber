# Uber Clone Microservices System

A distributed ride-hailing microservices backend simulating the core architecture and ride lifecycle of Uber. Built with Node.js (Express 5), Redis 7 (Geospatial indexing, TTL heartbeats, & atomic locks), PostgreSQL / Supabase (relational ride state machine), and Nginx (edge reverse proxy & load balancer).

---

## Architecture Overview

```
                                      [ Mobile Apps / Frontend Clients ]
                                                       │
                                                       ▼
                                         ┌───────────────────────────┐
                                         │       Nginx Ingress       │
                                         │   (Port 80 Load Balancer) │
                                         └─────────────┬─────────────┘
                                                       │
                                  (Round-Robin via Docker Embedded DNS)
                                                       │
                       ┌───────────────────────────────┴───────────────────────────────┐
                       ▼                                                               ▼
         ┌───────────────────────────┐                                   ┌───────────────────────────┐
         │     API Gateway Rep 1     │                                   │     API Gateway Rep 2     │
         │ (JWT Auth & Rate Limiter) │                                   │ (JWT Auth & Rate Limiter) │
         └─────────────┬─────────────┘                                   └─────────────┬─────────────┘
                       │                                                               │
                       └───────────────────────────────┬───────────────────────────────┘
                                                       │
                               (Header Enrichment: x-user-id, x-user-role)
                                                       │
                       ┌───────────────────────────────┼───────────────────────────────┐
                       ▼                               ▼                               ▼
         ┌───────────────────────────┐   ┌───────────────────────────┐   ┌───────────────────────────┐
         │  Location Service : 3003  │   │    Ride Service : 3001    │   │  Matching Service : 3002  │
         │  (Driver GPS Telemetry)   │   │  (Fares, OSRM, Lifecycle) │   │   (15s Offer Dispatch)    │
         └─────────────┬─────────────┘   └─────────────┬─────────────┘   └─────────────┬─────────────┘
                       │                               │                               │
                       ▼                               ▼                               ▼
                 ┌───────────┐                  ┌─────────────┐                  ┌───────────┐
                 │  Redis 7  │                  │ PostgreSQL  │                  │  Redis 7  │
                 │ (GEO+TTL) │                  │ (Supabase)  │                  │ (Locks)   │
                 └───────────┘                  └─────────────┘                  └───────────┘
```

---

## Services & Ports

| Service | Port | Datastore | Responsibilities | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Nginx Ingress** | `80` | None | Edge reverse proxy, SSL termination, keep-alives, connection buffering, and load balancing across Gateway replicas. | **Completed & Verified** |
| **API Gateway** | `3000` (internal) | None | Public entrypoint verifying JWT tokens (`Authorization: Bearer`), enforcing rate limits (120 req/min), stripping spoofed headers, and proxying requests. | **Completed & Verified** |
| **Ride Service** | `3001` | PostgreSQL (Supabase) | Source of truth for relational records, OSRM real-road fare estimates (`POST /fare`), ride requests (`POST /rides`), ride state machine (`requested` -> `accepted` -> `completed`), driver status. | **Completed & Verified** |
| **Matching Service** | `3002` | Redis 7 | Dispatches 15-second driver offers, enforces atomic locks (`EX 15 NX`), tracks declines, and cascades through expanding search radii (`[2km, 5km, 10km]`). | **Completed & Verified** |
| **Location Service** | `3003` | Redis 7 | Ingests driver GPS telemetry (`POST /drivers/location`), manages 30s heartbeat TTL, provides radius-based driver searches (`GET /internal/drivers/nearby`). | **Completed & Verified** |

---

## Tech Stack
* **Runtime**: Node.js (Express 5 natively handling async rejections)
* **Ingress & Load Balancer**: Nginx Alpine (`upstream` round-robin connection pool)
* **Mapping Engine**: OSRM (Open Source Routing Machine) turn-by-turn road routing + Google Maps Distance Matrix adapter + Haversine fallback
* **In-Memory Store**: Redis 7 Alpine (`GEOADD`, `GEOSEARCH`, TTL heartbeats, atomic locks `SET ... EX 15 NX`)
* **Relational Database**: PostgreSQL 16 (Hosted on Supabase over SSL with connection pooling)
* **Authentication**: Signed JSON Web Tokens (JWT) decoded at Gateway, enriched into trusted microservice headers (`x-user-id`, `x-user-role`, `x-internal-key`)
* **Containerization**: Docker Compose with multi-replica horizontal scaling (`--scale gateway=2`)

---

## Key Concurrency & Architectural Highlights
1. **Zero-PM2 Container Scaling**: Horizontal scaling is managed cleanly at the Docker/container layer via `--scale gateway=N`. Docker's internal DNS automatically load balances traffic across replica IPs.
2. **Atomic Driver Offer Locking**: `SET driver:<id>:offer <rideId> EX 15 NX` guarantees that two competing rides can never be offered to the same driver simultaneously.
3. **Partial Unique Index (`one_open_ride_per_driver`)**: PostgreSQL constraint guarantees at the database level that no driver can hold more than one active trip.
4. **Heartbeat Pruning**: Drivers who close their app or drop off the network are automatically purged from nearby searches within 30 seconds via Redis key expiration.
5. **Real-World Turn-by-Turn Routing (OSRM)**: Calculates exact driving distance, route duration, and dynamic fares using OpenStreetMap road networks with zero third-party billing friction.

---

## Quick Start & Testing

### Option A: Running Full Stack in Docker (Recommended)
```powershell
# 1. Boot entire cluster with 2 Gateway replicas behind Nginx
docker compose up -d --build --scale gateway=2

# 2. Run automated end-to-end verification through Nginx (Port 80)
.\scripts\test-gateway.ps1
```

### Option B: Running Locally with Node.js
```powershell
# 1. Start Redis
docker compose up -d redis

# 2. Start services in separate terminals
cd location-service; node src/server.js
cd ride-service; node src/server.js
cd matching-service; node src/server.js
cd gateway; node src/server.js

# 3. Run automated test
.\scripts\test-gateway.ps1 http://localhost:3000
```
