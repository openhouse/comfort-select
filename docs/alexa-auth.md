# Alexa authentication workflow (alexa-cookie2)

This project now uses [`alexa-cookie2`](https://www.npmjs.com/package/alexa-cookie2) to bootstrap and refresh Alexa authentication data for the actuator bridge.

## Environment knobs

Add/update these in your `.env` (defaults are shown in `.env.example`):

- `ALEXA_COOKIE_JSON=./config/secrets/alexa-cookie.json` (path to persisted cookie JSON)
- `ALEXA_AMAZON_DOMAIN` (e.g., `amazon.com`)
- `ALEXA_SERVICE_HOST` (regional Alexa API host, e.g., `pitangui.amazon.com`)
- `ALEXA_ACCEPT_LANGUAGE` (e.g., `en-US`)
- `ALEXA_USER_AGENT` (use a realistic browser UA string)
- `ALEXA_COOKIE_PROXY_PORT` (e.g., `3456`)
- `ALEXA_COOKIE_PROXY_OWN_IP` / `ALEXA_COOKIE_PROXY_LISTEN_BIND` (proxy host/bind for the browser flow)
- `ALEXA_INIT_TIMEOUT_MS` (defaults to 120000ms)
- `ALEXA_USE_WS_MQTT` (toggle push transport; defaults to `false`)
- `ALEXA_MACDMS` (only needed if you inject a raw cookie via env; the JSON file should already include this)
- `ALEXA_REMOTE_LOGGER` / `DEBUG_ALEXA` (opt-in alexa-remote2 debug logs, sanitized)
- `ALEXA_HTTP_TRACE` (opt-in per-request trace logging; headers/cookies are redacted)
- `DEBUG_SECRETS=1` (only if you intentionally want full tokens printed; otherwise hashes/tails are logged)

## Generate a cookie (browser proxy flow)

```bash
npm run alexa:cookie:init
```

1. The script prints a proxy URL (e.g., `http://localhost:3456/`).
2. Open it in your browser and complete the Amazon login/MFA flow.
3. On success, the full registration object is written to `config/secrets/alexa-cookie.json` (or your configured path).

## Refresh an existing cookie (no browser)

```bash
npm run alexa:cookie:refresh
```

This reuses the stored `refreshToken`/`loginCookie` fields to update the registration data in-place.

## Using the cookie

- The actuator bridge (`npm run actuator-bridge`) loads the root `.env` automatically and will pull cookie data from `ALEXA_COOKIE_JSON`. The stored JSON **must** include `macDms`; regenerate via `npm run alexa:cookie:init` if it is missing.
- `npm run alexa:list-routines` also loads `.env` so it uses the same cookie file.
- All post-cookie HTTP calls share the same cookie/CSRF headers. To debug, set `ALEXA_HTTP_TRACE=1`; responses are redacted by default and the routines response is written to `./debug/alexa-routines-response-<timestamp>.txt` when it fails to parse.

## Expected JSON shape (example, redacted)

```json
{
  "loginCookie": "...",
  "localCookie": "...",
  "csrf": "...",
  "refreshToken": "...",
  "tokenDate": "2024-11-10T12:34:56Z",
  "amazonPage": "amazon.com",
  "updatedAt": "2025-01-01T00:00:00.000Z"
}
```

Keep this file out of version control (see `.gitignore`).

## Debugging checklist

- Run the bridge with `LOG_LEVEL=debug ALEXA_HTTP_TRACE=1` to capture per-request metadata (URL/method/status/content-type and a short body preview).
- If a routines fetch or the authentication canary fails, check the saved redacted body in `./debug/` (override with `ALEXA_DEBUG_DIR`).
- To see unsanitized secrets locally, set `DEBUG_SECRETS=1` **temporarily**; by default only hashes/tails are logged.

## Production/Dokku hint

Mount `config/secrets/` as persistent storage. Run `npm run alexa:cookie:init` inside the container and SSH-tunnel the proxy port to your laptop to complete the browser login; the JSON will stay on the mounted volume.
