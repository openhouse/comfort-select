# comfort-196 (MVP)

A Node/TypeScript service that runs every **N minutes** to:
1) fetch outdoor weather for 196 Clinton Ave, Brooklyn, NY 11205  
2) fetch indoor temperature/humidity from Ecowitt sensors (per-sensor logging; living room has ambient + radiator-proximate)  
3) load MongoDB cycle history (append-only) to build the LLM prompt  
4) call the OpenAI API with a dynamic prompt (panel-style “expert perspectives” + structured output)  
5) actuate:
   - Vornado Transom AE (bathroom + kitchen) via an Alexa adapter
   - Vornado 630 fans (kitchen + living room) via Meross smart plugs adapter
6) persist the CycleRecord to MongoDB and rebuild a Google Sheets dashboard tab (best-effort, rolling window)

> Note on “role play”: this repo **does not claim** to be real people. It asks the model to produce an *imagined panel* inspired by named experts, but it must not claim identity.

## Quick start (local)

### 1) Install
```bash
npm install
cp .env.example .env
```

### 2) Start MongoDB locally
Run Mongo with Docker (data in a local volume):
```bash
docker run --name comfort-mongo -d -p 27017:27017 mongo:6
```

### 3) Configure

Edit `.env`:

* OpenAI:
  * `OPENAI_API_KEY`
  * `OPENAI_MODEL` (default `gpt-5.2`)
* MongoDB (source of truth for history):
  * `MONGODB_URI` (or `MONGO_URL`) — for local Docker: `mongodb://localhost:27017`
  * `MONGODB_DB_NAME` (default `comfort_select`)
  * `MONGODB_COLLECTION` (default `cycle_records`)
* Google Sheets dashboard (projection only):
  * `GOOGLE_SHEETS_SPREADSHEET_ID`
  * `GOOGLE_SHEETS_SHEET_NAME` (system-owned data tab, default `TimeSeries`)
  * `GOOGLE_SERVICE_ACCOUNT_JSON`
  * `SHEET_SYNC_ROWS` (default `2000`, number of most recent cycles mirrored to Sheets)
* Prompt + site configuration:
  * `PROMPT_TEMPLATE_PATH` (default `./config/prompt/llm-prompt-template.md.hbs`)
  * `SITE_CONFIG_PATH` (default `./config/site.config.json`)
  * Optional: `CURATORS_JSON` (JSON array string to override curators; defaults to site config)
* Pick sensor source:

  * `ECOWITT_SOURCE=mock` (default) uses `mock/ecowitt.sample.json`
  * `ECOWITT_SOURCE=local_gateway` polls `ECOWITT_GATEWAY_URL` and extracts keys defined in `config/sensors.mapping.json`
  * `ECOWITT_SOURCE=cloud_api` uses the Ecowitt Cloud API (recommended for Dokku/DO)
    * set `ECOWITT_CLOUD_APPLICATION_KEY` and `ECOWITT_CLOUD_API_KEY`
    * optional: set `ECOWITT_CLOUD_DEVICE_MAC` to target a specific device; otherwise the first device is used
    * adjust `config/sensors.mapping.json` if the cloud payload keys differ from your devices
* Actuation:

  * set `DRY_RUN=true` initially
  * optionally point `ALEXA_WEBHOOK_URL` + `MEROSS_WEBHOOK_URL` to your own endpoints
* History + prompt controls:
  * `HISTORY_MODE=window|full` (default `window`)
  * `HISTORY_ROWS=200` (rows of history, excluding header, when `window`)
* `PROMPT_MAX_CHARS=120000` (safety cap on history CSV length)
* `HTTP_TIMEOUT_MS=10000` (network timeout for sensors/weather/webhooks/OpenAI)

### 4) Initialize the sheet header row (overwrites the data tab)

```bash
npm run init-sheet
```

### 5) Run once (requires Mongo running)

```bash
npm run run-once
```

### 6) Run the daemon

```bash
npm run dev
```

Open [http://localhost:3000/healthz](http://localhost:3000/healthz) to see cycle status.

### Prompt + site configuration

The LLM prompt is rendered from a Handlebars template and a site JSON config:

* Template: `config/prompt/llm-prompt-template.md.hbs` (override with `PROMPT_TEMPLATE_PATH`)
* Site config: `config/site.config.json` (override with `SITE_CONFIG_PATH`)
* Curators: defaults come from the site config, but you can override via `CURATORS_JSON` env
* Dev helper: `npm run print-prompt` renders the current prompt using mock sensors + live weather (falls back to a stub if unavailable)

Edit these files to change curator names or site facts without touching TypeScript. The prompt is validated at load time via Zod; malformed JSON will fail fast.

## MongoDB as the primary history store

* MongoDB stores the full `CycleRecord` (weather, sensors, telemetry, features, decision, actuation) in an append-only collection (default `cycle_records`).
* Prompt history is pulled from MongoDB (not Sheets). `HISTORY_MODE` + `HISTORY_ROWS` control the query window, and the prompt renderer further trims if `PROMPT_MAX_CHARS` is exceeded.
* Each cycle inserts with a unique `decision_id`, indexed timestamps, and a deterministic hash of the current site config for observability.
* MongoDB errors are treated as blocking (to avoid actuating without durable history). Sheet export errors are non-blocking.
* `npm run rebuild-sheet` reloads the most recent `SHEET_SYNC_ROWS` records from MongoDB and overwrites the managed sheet tab.

## Google Sheets layout (dashboard projection)

* `GOOGLE_SHEETS_SHEET_NAME` is **system-owned**. Every cycle clears and rewrites that tab with `[header, last SHEET_SYNC_ROWS]` derived from MongoDB.
* Put user charts/analysis on a separate tab (e.g., `Dashboard`) that references the data tab; the system will not touch other tabs.
* The header is derived from the current site config. If sensors/devices/features change, the tab is rebuilt automatically; older records will show blanks for fields that did not exist yet.
* Sheet sync is best-effort; the control loop continues even if the Sheets API is unreachable.

## Actuation adapters (MVP)

To keep the MVP deployable **without** fragile vendor auth flows, actuation is done via simple webhook adapters:

* Alexa / Transom: POST to `ALEXA_WEBHOOK_URL`
* Meross plugs: POST to `MEROSS_WEBHOOK_URL`

Each request includes a bearer token and a structured payload. You can implement the webhook receiver however you like:

* Home Assistant webhook → automation
* a tiny local service that calls `alexa-remote2` or a Meross library
* any other bridge

When `DRY_RUN=true`, the service logs the actions but does not call webhooks.

## Deploy to DigitalOcean + Dokku (outline)

1. Create a Dokku app:

```bash
dokku apps:create comfort-196
```

2. Provision MongoDB with persistence (using the Dokku plugin):

```bash
dokku plugin:install https://github.com/dokku/dokku-mongo.git mongo
dokku mongo:create comfort-select-db
dokku mongo:link comfort-select-db comfort-196
```

This injects `MONGO_URL`; the app accepts either `MONGO_URL` or `MONGODB_URI`.

3. Set config vars (include Mongo + Sheets):

```bash
dokku config:set comfort-196 \
  OPENAI_API_KEY=... \
  GOOGLE_SHEETS_SPREADSHEET_ID=... \
  GOOGLE_SHEETS_SHEET_NAME=TimeSeries \
  GOOGLE_SERVICE_ACCOUNT_JSON=/app/service-account.json \
  HOME_LAT=40.692 HOME_LON=-73.969306 \
  CYCLE_MINUTES=5 TIMEZONE=America/New_York \
  DRY_RUN=true \
  SHEET_SYNC_ROWS=2000
```

4. Push:

```bash
git push dokku main
```

5. Check logs:

```bash
dokku logs comfort-196 -t
```

For cloud sensors, also set:

```bash
dokku config:set comfort-196 \
  ECOWITT_SOURCE=cloud_api \
  ECOWITT_CLOUD_APPLICATION_KEY=... \
  ECOWITT_CLOUD_API_KEY=... \
  ECOWITT_CLOUD_DEVICE_MAC=...
```

## Safety + reliability (MVP stance)

You asked for “little prejudice” and minimal guardrails. This MVP only includes:

* strict JSON schema validation for the model output
* “fail closed” behavior (if the model response is invalid or APIs fail, it does not actuate)
* optional `DRY_RUN`

Anything more sophisticated (hysteresis, minimum runtimes, comfort bands) can be layered later.
