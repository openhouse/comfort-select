# comfort-196 (MVP)

A Node/TypeScript service that runs every **N minutes** to:
1) fetch outdoor weather for 196 Clinton Ave, Brooklyn, NY 11205  
2) fetch indoor temperature/humidity from Ecowitt sensors (6 rooms + radiator-adjacent sensor)  
3) read the full Google Sheets time-series history  
4) call the OpenAI API with a dynamic prompt (panel-style “expert perspectives” + structured output)  
5) actuate:
   - Vornado Transom AE (bathroom + kitchen) via an Alexa adapter
   - Vornado 630 fans (kitchen + living room) via Meross smart plugs adapter
6) append a new row to Google Sheets with observations + decisions + actuation results

> Note on “role play”: this repo **does not claim** to be real people. It asks the model to produce an *imagined panel* inspired by named experts, but it must not claim identity.

## Quick start (local)

### 1) Install
```bash
npm install
cp .env.example .env
```

### 2) Configure

Edit `.env`:

* `OPENAI_API_KEY`
* Google Sheets: `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`
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

### 3) Initialize the sheet header row

```bash
npm run init-sheet
```

### 4) Run once

```bash
npm run run-once
```

### 5) Run the daemon

```bash
npm run dev
```

Open [http://localhost:3000/healthz](http://localhost:3000/healthz) to see cycle status.

## Google Sheets layout

This MVP uses a single tab (default `TimeSeries`) and appends one row per cycle.
The header row is written by `scripts/init-sheet.ts`.

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

2. Set config vars:

```bash
dokku config:set comfort-196 \
  OPENAI_API_KEY=... \
  GOOGLE_SHEETS_SPREADSHEET_ID=... \
  GOOGLE_SHEETS_SHEET_NAME=TimeSeries \
  HOME_LAT=40.6897 HOME_LON=-73.9635 \
  CYCLE_MINUTES=5 TIMEZONE=America/New_York \
  DRY_RUN=true
```

For cloud sensors, also set:

```bash
dokku config:set comfort-196 \
  ECOWITT_SOURCE=cloud_api \
  ECOWITT_CLOUD_APPLICATION_KEY=... \
  ECOWITT_CLOUD_API_KEY=... \
  ECOWITT_CLOUD_DEVICE_MAC=...
```

3. Provide the Google service account JSON inside the container:

* simplest MVP approach: add it as a Dokku config file and mount it to `/app/service-account.json`
* then set: `GOOGLE_SERVICE_ACCOUNT_JSON=/app/service-account.json`

4. Push:

```bash
git push dokku main
```

5. Check logs:

```bash
dokku logs comfort-196 -t
```

## Safety + reliability (MVP stance)

You asked for “little prejudice” and minimal guardrails. This MVP only includes:

* strict JSON schema validation for the model output
* “fail closed” behavior (if the model response is invalid or APIs fail, it does not actuate)
* optional `DRY_RUN`

Anything more sophisticated (hysteresis, minimum runtimes, comfort bands) can be layered later.
