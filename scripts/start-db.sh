#!/usr/bin/env bash
# Lance PostgreSQL local avec un volume nommé et sans supprimer de conteneurs.
# À lancer depuis la racine : bash scripts/start-db.sh
set -euo pipefail

: "${POSTGRES_DB:?Set POSTGRES_DB before starting the local database}"
: "${POSTGRES_USER:?Set POSTGRES_USER before starting the local database}"
: "${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD before starting the local database}"

container_name=helpdesk-db-local
if docker container inspect "$container_name" >/dev/null 2>&1; then
  echo "Container $container_name already exists; inspect it before taking any action." >&2
  exit 1
fi

docker volume create helpdesk-db-local-data >/dev/null
docker run -d --name "$container_name" --env POSTGRES_DB --env POSTGRES_USER --env POSTGRES_PASSWORD --publish 127.0.0.1:5432:5432 --mount type=volume,src=helpdesk-db-local-data,dst=/var/lib/postgresql/data --mount "type=bind,src=$(pwd)/db/init.sql,dst=/docker-entrypoint-initdb.d/init.sql,readonly" postgres:16-alpine >/dev/null
echo "PostgreSQL démarre sur 127.0.0.1:5432; les données sont conservées dans le volume helpdesk-db-local-data."
