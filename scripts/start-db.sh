#!/usr/bin/env bash
# Phase 1 : lance PostgreSQL dans Docker et charge db/init.sql (schéma + données fictives).
# À lancer depuis la racine du projet :  bash scripts/start-db.sh
set -e
docker rm -f helpdesk-db >/dev/null 2>&1 || true
docker run -d --name helpdesk-db \
  -e POSTGRES_DB=helpdesk -e POSTGRES_USER=helpdesk -e POSTGRES_PASSWORD=change_me_fictif_123 \
  -p 5432:5432 \
  -v "$(pwd)/db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro" \
  postgres:16-alpine
echo "PostgreSQL démarre sur localhost:5432 (attendre ~5 s avant de lancer le backend)."
