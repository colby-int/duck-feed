FROM node:22-alpine AS base
WORKDIR /app

# Install ffmpeg and chromaprint (fpcalc) for audio processing
RUN apk add --no-cache ffmpeg chromaprint

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# Dev target — source mounted as volume, tsx watch used
FROM base AS dev
CMD ["npx", "tsx", "watch", "src/index.ts"]

# Build target
FROM base AS build
RUN npm run build

# Production target
FROM node:22-alpine AS production
WORKDIR /app

RUN apk add --no-cache ffmpeg chromaprint wget

COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/src/db ./src/db
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

CMD ["node", "dist/index.js"]
