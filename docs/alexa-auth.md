# Alexa authentication workflow (alexa-cookie2)

This project now uses [`alexa-cookie2`](https://www.npmjs.com/package/alexa-cookie2) to bootstrap and refresh Alexa authentication data for the actuator bridge.

## Environment knobs

Add/update these in your `.env` (defaults are shown in `.env.example`):

- `ALEXA_COOKIE_JSON=./config/secrets/alexa-cookie.json` (path to persisted cookie JSON)
- `ALEXA_AMAZON_DOMAIN` (e.g., `amazon.com`)
- `ALEXA_ACCEPT_LANGUAGE` (e.g., `en-US`)
- `ALEXA_COOKIE_PROXY_PORT` (e.g., `3456`)
- `ALEXA_COOKIE_PROXY_OWN_IP` / `ALEXA_COOKIE_PROXY_LISTEN_BIND` (proxy host/bind for the browser flow)

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

- The actuator bridge (`npm run actuator-bridge`) loads the root `.env` automatically and will pull cookie data from `ALEXA_COOKIE_JSON`.
- `npm run alexa:list-routines` also loads `.env` so it uses the same cookie file.

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

## Production/Dokku hint

Mount `config/secrets/` as persistent storage. Run `npm run alexa:cookie:init` inside the container and SSH-tunnel the proxy port to your laptop to complete the browser login; the JSON will stay on the mounted volume.
