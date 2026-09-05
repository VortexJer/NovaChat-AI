# NovaChat — imagen de produccion
#
# Tres fases para que la imagen final solo lleve lo que hace falta en tiempo de
# ejecucion. La salida `standalone` de Next incluye unicamente los modulos que
# el servidor importa de verdad, asi que la imagen queda en ~150 MB y el
# proceso arranca en unos 80 MB de RAM. Ese margen es el que permite que quepa
# en el plan gratuito de Render, donde LobeChat se quedaba sin memoria.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` respeta el lockfile exacto; `install` podria resolver otras
# versiones y hacer que la imagen no coincida con lo probado.
RUN npm ci --omit=dev --ignore-scripts

FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=10000
ENV HOSTNAME=0.0.0.0

# Usuario sin privilegios: si alguien lograra ejecutar codigo dentro del
# contenedor, no lo haria como root.
RUN addgroup -g 1001 -S nodejs && adduser -S nova -u 1001

COPY --from=builder --chown=nova:nodejs /app/.next/standalone ./
# El servidor standalone no incluye ni los estaticos ni public: van aparte,
# en las rutas donde Next los espera.
COPY --from=builder --chown=nova:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nova:nodejs /app/public ./public

USER nova
EXPOSE 10000

CMD ["node", "server.js"]
