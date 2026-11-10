#!/bin/sh
# Apply pending migrations, then start the server.
# Migrations use DIRECT_DATABASE_URL when set (a pooler in transaction mode
# can't hold the migration lock), otherwise DATABASE_URL.
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL is not set" >&2
  exit 1
fi

cd /migrate
DATABASE_URL="${DIRECT_DATABASE_URL:-$DATABASE_URL}" node node_modules/prisma/build/index.js migrate deploy

cd /app
exec node server.js
