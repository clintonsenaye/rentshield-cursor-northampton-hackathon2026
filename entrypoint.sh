#!/bin/bash
# RentShield Docker entrypoint script.
# Seeds the database on startup, then launches the application server.

set -e

echo "=== RentShield Startup ==="

# Seed the database (idempotent - skips if data already exists)
echo "Seeding database..."
python seed_db.py

# Start the application server
echo "Starting server..."
exec uvicorn app:app --host 0.0.0.0 --port 8000
