# Discord interactions proxy, run on Cloud Run behind the API Gateway.
#
#   Only production dependencies are installed: discord.js is a dev dependency,
#   used by register-commands.js from a laptop or CI, never by the proxy.
#   Cloud Run sends traffic to $PORT (8080 by default).

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev
COPY handler.js local.js logger.js ./
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "local.js"]
