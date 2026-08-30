FROM node:24.19.0-bookworm-slim AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN corepack pnpm install --frozen-lockfile

COPY . .

ARG VITE_APP_ORIGIN
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_TURNSTILE_SITE_KEY
ARG VITE_GOOGLE_AUTH_ENABLED=false
ARG DEPLOY_ENV=production
ARG GITHUB_SHA=0000000000000000000000000000000000000000
ENV VITE_APP_ORIGIN=${VITE_APP_ORIGIN}
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ENV VITE_SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY}
ENV VITE_TURNSTILE_SITE_KEY=${VITE_TURNSTILE_SITE_KEY}
ENV VITE_GOOGLE_AUTH_ENABLED=${VITE_GOOGLE_AUTH_ENABLED}
ENV DEPLOY_ENV=${DEPLOY_ENV}
ENV GITHUB_SHA=${GITHUB_SHA}

RUN corepack pnpm build

FROM nginxinc/nginx-unprivileged:1.29.5-alpine

USER root
RUN apk upgrade --no-cache
USER 101

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/runtime-config.sh /docker-entrypoint.d/40-kuchitoru-runtime-config.sh
COPY --chown=101:101 --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/healthz || exit 1
