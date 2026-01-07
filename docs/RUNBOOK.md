# Runbook: comfort-select local setup

Environment used for verification:
- Node.js: `20` (per `.nvmrc`)
- Package manager: `npm` (lockfile committed)
- OS: containerized Linux (Codespace-style)

## Fresh checkout steps
1. `nvm use`
2. `npm install`
3. `cp .env.example .env`
4. Copy example configs if you have none yet:
   - `cp config/site.config.example.json config/site.config.json`
   - `cp config/sensors.mapping.example.json config/sensors.mapping.json`
   - `cp config/alexa.routines.example.json config/alexa.routines.json`

## Services
- **Main app**: `npm run dev` (or `npm run run-once` for a single cycle)
  - Health: `curl http://localhost:3000/healthz`
- **Actuator bridge**: `npm run actuator-bridge` (or `npm run dev:actuator-bridge`)
  - Health: `curl http://127.0.0.1:8787/healthz`
  - Readiness: `curl http://127.0.0.1:8787/readyz`
  - Combined dev: `npm run dev:all`

## Known notes
- The actuator bridge binds its port immediately; readiness flips true only after Alexa init + routine map load.
- Routine map resolution order: `ROUTINE_MAP_PATH` → `ALEXA_ROUTINE_MAP_PATH` → `./config/alexa.routines.json`.
- Sensitive cookies/tokens are redacted by default; set `DEBUG_ALEXA=1` only when sanitised debug logs are acceptable.
- Alexa auth + routines calls now share the same cookie/CSRF headers and default to a 120s init timeout. For regional hosts set `ALEXA_SERVICE_HOST` (e.g., `pitangui.amazon.com`) and use `ALEXA_HTTP_TRACE=1` to capture status/content-type/body previews for each call. Responses are written to `./debug/` when parsing fails.
- For deployment, Procfile includes both the main web process and an `actuator` process that runs the compiled bridge (`npm run start:actuator-bridge`).

### Alexa device setup
Use this flow to choose a valid routine execution device (required for `/alexa` actuation):
1. Generate or refresh the cookie (`npm run alexa:cookie:init` or `npm run alexa:cookie:refresh`).
2. List available devices: `npm run alexa:list-devices` (look for `accountName` + `serialNumber`).
3. Set `ALEXA_ROUTINE_DEVICE_NAME` (or `ALEXA_ROUTINE_DEVICE_SERIAL`) to an exact value from that list.
4. Restart the bridge.
5. Verify readiness: `curl -sS http://127.0.0.1:8787/readyz | jq .`.
6. Actuate via `/alexa` as usual and confirm the routine executes.

## Example smoke test
After starting the actuator bridge:
```bash
curl -sS http://127.0.0.1:8787/healthz | jq .
curl -sS http://127.0.0.1:8787/readyz | jq .
```

### Alexa routine bridge examples

Power-only device (e.g., Vornado 630 smart plug) via the unified Alexa endpoint:
```bash
TOKEN="$ALEXA_WEBHOOK_TOKEN"
curl -sS -X POST "http://127.0.0.1:8787/alexa" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"device":"KITCHEN_VORNADO_630","state":{"power":"ON"}}'
```

Transom actuation with full state:
```bash
TOKEN="$ALEXA_WEBHOOK_TOKEN"
curl -sS -X POST "http://127.0.0.1:8787/alexa" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"device":"KITCHEN_TRANSOM","state":{"power":"ON","direction":"EXHAUST","speed":"LOW"}}'
```

`/meross` remains available for backward compatibility and accepts either `plug` or `device` fields plus `state.power`.
