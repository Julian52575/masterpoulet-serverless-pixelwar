# Build the Vite/React frontend that lives in ./frontend.
#
#   npm ci + `vite build` in a builder stage, then copy just the static
# dist/ into a slim runtime image served by `serve` on :3000 as the
# unprivileged `node` user (uid 1000, matching the chart's securityContext).
# NO_UPDATE_CHECK stops serve phoning npm and caching the result, so nothing
# writes to the filesystem and the chart's read-only root filesystem holds.

FROM node:24-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./

RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
RUN npm install -g serve@14 \
 && npm cache clean --force
ENV NODE_ENV=production \
    NO_UPDATE_CHECK=1
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["serve", "-s", "dist", "-l", "3000", "--no-clipboard"]
