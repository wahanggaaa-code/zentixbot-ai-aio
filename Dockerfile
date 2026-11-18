FROM node:22-alpine

ENV NODE_ENV=production

WORKDIR /usr/src/app

# PostgreSQL backup and verification scripts invoke pg_dump and pg_restore.
RUN apk add --no-cache postgresql-client

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Jalankan sebagai user non-root; bot membuat data/ sendiri di dalam folder app.
RUN chown -R node:node /usr/src/app
USER node

EXPOSE 3000

# Liveness saja. Untuk monitoring lengkap (200/503, ada cek database) pakai /ready.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/health" || exit 1

# Entrypoint node langsung (sama seperti npm start) agar SIGTERM dari Docker langsung diterima bot.
CMD ["node", "src/app.js"]
