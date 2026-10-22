# Build the Express/Prisma API that lives in ./backend.
#
#   npm ci in a builder stage, generate the Prisma client, then copy just
#   node_modules + src + prisma into a slim runtime image. The app listens
# on :3000 and is routed by Traefik. `prisma migrate deploy` runs on
# container start so the schema is applied against the `db` service before
# the app starts serving requests.

FROM node:24-slim AS build
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY prisma ./prisma
RUN npx prisma generate

FROM node:24-slim
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY prisma ./prisma
COPY src ./src
USER node
EXPOSE 3000
# exec: node replaces sh as PID 1 so SIGTERM reaches it and shutdown is graceful.
CMD ["sh", "-c", "npx prisma migrate deploy && exec node src/server.js"]
