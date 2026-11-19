-- Ride Service Database Schema (PostgreSQL / Supabase)
-- Safe to run repeatedly (IF NOT EXISTS)

-- Drivers: Availability and state live here
CREATE TABLE IF NOT EXISTS drivers (
  id          TEXT PRIMARY KEY,
  status      TEXT NOT NULL DEFAULT 'offline'
              CHECK (status IN ('available', 'inRide', 'offline')),
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rides: Tracks single ride from quote to completion
CREATE TABLE IF NOT EXISTS rides (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id     TEXT NOT NULL,
  driver_id    TEXT REFERENCES drivers(id),
  fare         NUMERIC(10,2) NOT NULL CHECK (fare >= 0),
  eta          INTEGER NOT NULL CHECK (eta >= 0),
  source       JSONB NOT NULL,
  destination  JSONB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'fare-estimated'
               CHECK (status IN ('fare-estimated', 'requested', 'accepted',
                                 'completed', 'no-driver-found')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Query performance indexes
CREATE INDEX IF NOT EXISTS rides_rider_idx  ON rides (rider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rides_driver_idx ON rides (driver_id);
CREATE INDEX IF NOT EXISTS rides_status_idx ON rides (status);

-- Concurrency Safety: A driver can hold at most ONE open ride (offered or in-progress)
CREATE UNIQUE INDEX IF NOT EXISTS one_open_ride_per_driver
  ON rides (driver_id)
  WHERE driver_id IS NOT NULL AND status IN ('requested', 'accepted');

-- Enable Row Level Security (RLS) to lock down the public Supabase API
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE rides   ENABLE ROW LEVEL SECURITY;