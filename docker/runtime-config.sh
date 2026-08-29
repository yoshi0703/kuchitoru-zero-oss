#!/bin/sh
set -eu

escape_js_string() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

app_origin=$(escape_js_string "${KUCHITORU_APP_ORIGIN:-}")
supabase_url=$(escape_js_string "${KUCHITORU_SUPABASE_URL:-}")
publishable_key=$(escape_js_string "${KUCHITORU_SUPABASE_PUBLISHABLE_KEY:-}")
turnstile_site_key=$(escape_js_string "${KUCHITORU_TURNSTILE_SITE_KEY:-}")

printf 'window.__KUCHITORU_RUNTIME_CONFIG__ = {"appOrigin":"%s","supabaseUrl":"%s","supabasePublishableKey":"%s","turnstileSiteKey":"%s"};\n' \
  "$app_origin" "$supabase_url" "$publishable_key" "$turnstile_site_key" \
  > /usr/share/nginx/html/runtime-config.js
