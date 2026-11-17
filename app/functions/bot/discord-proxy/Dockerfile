FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev
COPY handler.js local.js logger.js interaction.js publisher.js config.js ./
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "local.js"]
