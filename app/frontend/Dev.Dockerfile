# Dev-mode image for the Vite/React frontend that lives in ./frontend.
# Runs the Vite dev server with HMR; not a production build.

FROM node:24-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .
EXPOSE 3000
CMD ["npx", "vite", "--host", "0.0.0.0", "--port", "3000"]
