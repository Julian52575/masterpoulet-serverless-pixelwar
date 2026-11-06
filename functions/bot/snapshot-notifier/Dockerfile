FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev
COPY local.js notifier.js cloudevent.js links.js config.js discord.js logger.js ./
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "local.js"]
