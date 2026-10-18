# Railway: set the service's Root Directory to `recorder/`.
FROM node:22-bookworm-slim AS build
WORKDIR /app
# patches/ must be present for the postinstall (patch-package) that fixes DAVE receive.
COPY package.json package-lock.json ./
COPY patches ./patches
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
EXPOSE 3000
CMD ["node", "dist/index.js"]
