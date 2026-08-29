#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
BUNDLE_DIR="$ROOT/deploy/self-hosted/supabase"
UPSTREAM_TAG="self-hosted/v0.8.0"
UPSTREAM_COMMIT="241bb11c0627f2981746d37033f57dbfa81d29b0"
OVERRIDE="$ROOT/deploy/self-hosted/community.compose.yml"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  }
}

bootstrap() {
  require_command git
  require_command openssl
  require_command docker
  docker compose version >/dev/null

  if [ -f "$BUNDLE_DIR/docker-compose.yml" ]; then
    recorded=$(sed -n 's/^ref=//p' "$BUNDLE_DIR/.supabase-version" 2>/dev/null || true)
    [ "$recorded" = "$UPSTREAM_TAG" ] || {
      printf 'Existing Supabase bundle is not %s. Review it before replacing files.\n' "$UPSTREAM_TAG" >&2
      exit 1
    }
    printf 'Supabase bundle already prepared at %s\n' "$BUNDLE_DIR"
    return
  fi

  [ ! -e "$BUNDLE_DIR" ] || {
    printf 'Refusing to overwrite existing path: %s\n' "$BUNDLE_DIR" >&2
    exit 1
  }

  temp_dir=$(mktemp -d)
  trap 'rm -rf "$temp_dir"' EXIT HUP INT TERM
  git clone --depth 1 --branch "$UPSTREAM_TAG" --filter=blob:none --sparse \
    https://github.com/supabase/supabase.git "$temp_dir/supabase"
  git -C "$temp_dir/supabase" sparse-checkout set docker
  resolved=$(git -C "$temp_dir/supabase" rev-parse HEAD)
  [ "$resolved" = "$UPSTREAM_COMMIT" ] || {
    printf 'Unexpected Supabase commit: %s\n' "$resolved" >&2
    exit 1
  }

  mkdir -p "$BUNDLE_DIR"
  cp -R "$temp_dir/supabase/docker/." "$BUNDLE_DIR/"
  cp "$BUNDLE_DIR/.env.example" "$BUNDLE_DIR/.env"
  (
    cd "$BUNDLE_DIR"
    sh utils/generate-keys.sh --update-env
    sh utils/add-new-auth-keys.sh --update-env
  )

  ai_master_key=$(openssl rand -base64 32)
  session_derivation_key=$(openssl rand -base64 32)
  rate_limit_hmac_key=$(openssl rand -base64 32)
  meo_jobs_token=$(openssl rand -base64 32 | tr -d '\n')
  {
    printf '\n# Kuchitoru Zero Community\n'
    printf 'PGRST_DB_SCHEMAS=api\n'
    printf 'WEB_PORT=3000\n'
    printf 'COMMUNITY_WEB_IMAGE=ghcr.io/yoshi0703/kuchitoru-zero-oss:v1.0.0\n'
    printf 'AI_CREDENTIALS_MASTER_KEY_V1=%s\n' "$ai_master_key"
    printf 'AI_CREDENTIALS_ACTIVE_KEY_VERSION=1\n'
    printf 'SESSION_TOKEN_DERIVATION_KEY=%s\n' "$session_derivation_key"
    printf 'RATE_LIMIT_HMAC_KEY=%s\n' "$rate_limit_hmac_key"
    printf 'TURNSTILE_SITE_KEY=\nTURNSTILE_SECRET_KEY=\n'
    printf 'OPENAI_INTERVIEW_MODEL=\nOPENAI_REVIEW_MODEL=\nOPENAI_REWRITE_MODEL=\n'
    printf 'GEMINI_INTERVIEW_MODEL=\nGEMINI_REVIEW_MODEL=\nGEMINI_REWRITE_MODEL=\n'
    printf 'DEEPSEEK_INTERVIEW_MODEL=\nDEEPSEEK_REVIEW_MODEL=\nDEEPSEEK_REWRITE_MODEL=\n'
    printf 'XAI_INTERVIEW_MODEL=\nXAI_REVIEW_MODEL=\nXAI_REWRITE_MODEL=\n'
    printf 'ANTHROPIC_INTERVIEW_MODEL=\nANTHROPIC_REVIEW_MODEL=\nANTHROPIC_REWRITE_MODEL=\n'
    printf 'GOOGLE_BUSINESS_CLIENT_ID=\nGOOGLE_BUSINESS_CLIENT_SECRET=\nGOOGLE_BUSINESS_REDIRECT_URI=\n'
    printf 'INSTAGRAM_APP_ID=\nINSTAGRAM_APP_SECRET=\nINSTAGRAM_REDIRECT_URI=\nINSTAGRAM_API_VERSION=v25.0\n'
    printf 'MEO_JOBS_ENABLED=false\nMEO_JOBS_TOKEN=%s\n' "$meo_jobs_token"
  } >> "$BUNDLE_DIR/.env"
  {
    printf '# Supabase self-hosted version stamp.\n'
    printf 'ref=%s\n' "$UPSTREAM_TAG"
    printf 'commit=%s\n' "$UPSTREAM_COMMIT"
  } > "$BUNDLE_DIR/.supabase-version"

  printf 'Prepared %s. Edit its .env before exposing the service publicly.\n' "$BUNDLE_DIR"
}

compose() {
  [ -f "$BUNDLE_DIR/.env" ] || bootstrap
  COMMUNITY_BUILD_SHA=$(git -C "$ROOT" rev-parse HEAD)
  export COMMUNITY_BUILD_SHA
  (
    cd "$BUNDLE_DIR"
    docker compose --env-file .env \
      -f docker-compose.yml \
      -f "$OVERRIDE" "$@"
  )
}

case "${1:-}" in
  bootstrap)
    bootstrap
    ;;
  up)
    compose up -d --wait --build
    ;;
  down)
    compose down
    ;;
  status)
    compose ps
    ;;
  logs)
    shift
    compose logs -f "$@"
    ;;
  config)
    compose config
    ;;
  seed)
    compose run --rm community-seed
    ;;
  *)
    printf 'Usage: %s {bootstrap|up|down|status|logs [service]|config|seed}\n' "$0" >&2
    exit 2
    ;;
esac
