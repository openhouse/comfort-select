# Dokku-friendly multi-stage Dockerfile
FROM node:20-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json* tsconfig.json ./
RUN npm ci

COPY src ./src
COPY scripts ./scripts
COPY config ./config
COPY mock ./mock

RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY config ./config
COPY mock ./mock

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
