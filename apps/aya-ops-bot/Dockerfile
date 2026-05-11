FROM node:22-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

FROM deps AS build
WORKDIR /app

COPY tsconfig.json ./
COPY src ./src
COPY README.md ROADMAP.md schema.sql ./

RUN npm run build

FROM deps AS prod-deps
WORKDIR /app

RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3010
ENV LOG_LEVEL=info

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json package-lock.json ./

RUN mkdir -p /app/data

EXPOSE 3010
VOLUME ["/app/data"]

CMD ["node", "dist/server.js"]
