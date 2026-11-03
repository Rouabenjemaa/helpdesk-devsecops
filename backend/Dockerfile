# =============================================================================
# HelpDesk DevSecOps - Dockerfile Backend Multi-Stage (Phase 2)
# =============================================================================

# Étape 1 : Build & Dépendances
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

# Étape 2 : Image d'exécution minimale avec utilisateur non privilégié (USER 10001)
FROM node:20-alpine
# Phase 5 : l'application n'a besoin que de node. npm et yarn (inutiles à l'exécution) sont retirés :
# cela supprime leur copie vulnérable de tar (CVE) et réduit la surface d'attaque.
RUN addgroup -g 10001 app && adduser -D -u 10001 -G app app \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
              /opt/yarn-v* /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY --from=build --chown=10001:10001 /app /app
USER 10001
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1
CMD ["node", "server.js"]
