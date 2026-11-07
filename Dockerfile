# Benchmark service and apps. Build:  docker build -t benchmark .
# Not built or run where this was written (no Docker daemon); see docs/07-deploy.md.

# 1. Build the React apps (needs the dev dependencies).
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci && npm run build -w @benchmark/web

# 2. Production dependencies only. The workspace manifests must be present for npm to link @benchmark/* packages.
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci --omit=dev

# 3. The runtime image: the service plus the built apps. No tests, no sources of the apps, no dev tooling.
FROM node:20-slim
ENV NODE_ENV=production PORT=8080 BENCHMARK_TRUST_PROXY=1
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages ./packages
COPY --from=build /app/packages/web/dist ./packages/web/dist
RUN rm -rf packages/*/test packages/web/src packages/web/public packages/web/*.html packages/web/vite.config.js \
 && useradd --system --no-create-home bm
USER bm
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "packages/service/bin/serve.mjs"]
