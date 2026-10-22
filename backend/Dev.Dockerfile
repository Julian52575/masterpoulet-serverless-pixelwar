# Dev-mode image for the Express/Prisma API that lives in ./backend.
# Runs nodemon with hot reload; not a production build.

FROM node:24-slim

WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

# Dependencies and the Prisma client are layered before the source, so a code
# edit does not reinstall or regenerate anything.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY prisma ./prisma
RUN npx prisma generate

COPY . .

EXPOSE 3000 9464
CMD ["sh", "-c", "npx prisma migrate deploy && npm run dev"]
