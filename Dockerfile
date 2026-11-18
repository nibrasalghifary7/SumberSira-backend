# syntax=docker/dockerfile:1

# ============================================================
# SumberSira Backend — image multi-stage
#   deps    : memasang dependency (termasuk dev) untuk tahap build
#   build   : generate Prisma Client + typecheck (npm run build)
#   runtime : hanya dependency produksi + kode sumber, dijalankan `tsx`
# File .env, node_modules lokal, dan folder pengembangan tidak ikut ke image
# (lihat .dockerignore). Rahasia hanya diisi saat runtime.
# ============================================================

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: Prisma Client dibuat di tahap build setelah skema tersedia.
RUN npm ci --ignore-scripts


FROM node:22-bookworm-slim AS build
WORKDIR /app
# Nilai dummy: hanya dipakai `prisma generate`, bukan koneksi sungguhan.
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build"
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json prisma.config.ts tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
# types/ dan file deklarasi ikut karena berada di dalam src/
RUN npx prisma generate && npm run build


FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Hanya dependency produksi. Skrip pasca-install dilewati karena Prisma Client
# sudah dibangun di tahap sebelumnya dan disalin apa adanya.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/generated ./generated
COPY --from=build /app/src ./src
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/prisma.config.ts ./prisma.config.ts

# Folder unggahan lokal (hanya dipakai bila STORAGE_DRIVER=local).
RUN mkdir -p uploads && chown -R node:node /app
USER node

EXPOSE 4000

# Readiness check memakai /health/live (tidak menyentuh database, jadi aman
# dipanggil sering). Endpoint /health dipakai orchestrator untuk siap-trafik.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health/live').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Sinyal SIGTERM dari Docker diterima langsung oleh handler di src/index.ts.
CMD ["npm", "start"]
