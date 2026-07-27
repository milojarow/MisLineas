# Digest-pinned so a rebuild can never silently move to a different base.
# docker.io/library/node:24-bookworm-slim as of 2026-07-26.
FROM docker.io/library/node@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS base

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /usr/src/app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

FROM base AS dependencies

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM dependencies AS build

COPY . .
RUN pnpm build

FROM docker.io/library/node@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS production

ENV NODE_ENV=production
# Node's libuv threadpool defaults to 4, and getaddrinfo() runs on it. A lookup
# fans out to a dozen carriers at once, so DNS would queue four at a time.
ENV UV_THREADPOOL_SIZE=64

WORKDIR /usr/src/app

COPY --from=build --chown=node:node /usr/src/app/public ./public
COPY --from=build --chown=node:node /usr/src/app/.next/standalone ./
COPY --from=build --chown=node:node /usr/src/app/.next/static ./.next/static

USER node
EXPOSE 3000

CMD ["node", "server.js"]
