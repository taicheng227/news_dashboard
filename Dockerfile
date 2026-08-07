FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY config ./config
COPY migrations ./migrations
COPY schemas ./schemas
COPY prompts ./prompts
COPY scripts ./scripts
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl python3 \
  && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod 0755 /usr/local/bin/yt-dlp \
  && apt-get purge -y --auto-remove curl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./package.json
COPY scripts/run-backup.js ./scripts/run-backup.js
COPY migrations ./migrations
COPY schemas ./schemas
COPY prompts ./prompts
COPY public ./public
COPY src/web/views ./src/web/views
EXPOSE 3000
CMD ["node", "dist/src/server.js"]
