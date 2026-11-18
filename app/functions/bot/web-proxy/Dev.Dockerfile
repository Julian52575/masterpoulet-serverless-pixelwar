# Dev-mode image for web-proxy function
FROM node:24-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .
EXPOSE 8080
CMD ["npm", "start"]
