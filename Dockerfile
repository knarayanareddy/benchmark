# Benchmark service. Build:  docker build -t benchmark .
FROM node:20-slim AS deps
WORKDIR /app
# The workspace manifests must be present for npm to link @benchmark/* packages.
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci --omit=dev

FROM node:20-slim
ENV NODE_ENV=production PORT=8080 BENCHMARK_TRUST_PROXY=1
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages ./packages
# The service needs no source data, tests or archive. It runs as an unprivileged user.
RUN rm -rf packages/*/test && useradd --system --no-create-home bm
USER bm
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "packages/service/bin/serve.mjs"]
