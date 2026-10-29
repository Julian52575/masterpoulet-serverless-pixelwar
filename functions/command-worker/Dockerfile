FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev
COPY local.js worker.js envelope.js handlers.js logger.js discord.js authz.js config.js state.js reply.js limits.js grid.js palette.js draw.js ./
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "local.js"]
