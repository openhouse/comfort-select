import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import AlexaRemote from "alexa-remote2";
import type { Logger } from "pino";
import {
  type AlexaCookieData,
  extractCookieString,
  extractCsrf,
  getCookiePath,
  loadCookieData,
  maybeRefreshCookieData,
  sanitizeForLogs,
  saveCookieData
} from "./cookieStore.js";
import { resolveFromRepo } from "./env.js";

export type RoutineMap = Record<string, string>;
export type RoutineState = {
  power?: string;
  direction?: string;
  speed?: string;
};

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
const SECRET_DEBUG =
  process.env.DEBUG_SECRETS === "1" || process.env.DEBUG_SECRETS?.toLowerCase() === "true" || false;
const HTTP_TRACE =
  process.env.ALEXA_HTTP_TRACE === "1" || process.env.ALEXA_HTTP_TRACE?.toLowerCase() === "true" || false;

function toBool(envValue: string | undefined): boolean | undefined {
  if (envValue === undefined) return undefined;
  const normalized = envValue.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function summarizeSecret(secret: string | undefined | null): string | undefined {
  if (!secret) return undefined;
  if (SECRET_DEBUG) return secret;
  const str = String(secret);
  const tail = str.slice(-6);
  const hash = crypto.createHash("sha256").update(str).digest("hex").slice(0, 10);
  return `len=${str.length};sha256=${hash};tail=${tail}`;
}

function redactBody(body: string, maxPreview = 200): { preview: string; length: number } {
  const sanitized = sanitizeForLogs(body ?? "");
  if (sanitized.length <= maxPreview) return { preview: sanitized, length: sanitized.length };
  return { preview: `${sanitized.slice(0, maxPreview)}…`, length: sanitized.length };
}

async function persistHttpBody(label: string, body: string, logger: Logger): Promise<string> {
  const debugDir = resolveFromRepo(process.env.ALEXA_DEBUG_DIR ?? "debug");
  await fs.mkdir(debugDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(debugDir, `${label}-${timestamp}.txt`);
  const payload = SECRET_DEBUG ? body : sanitizeForLogs(body);
  await fs.writeFile(filePath, payload, "utf-8");
  logger.warn({ filePath }, "Saved Alexa HTTP response for debugging");
  return filePath;
}

async function tracedFetch(
  logger: Logger,
  step: string,
  url: string,
  init: RequestInit
): Promise<{ response: Response; body: string }> {
  const start = Date.now();
  const headersEntries =
    init.headers instanceof Headers
      ? Array.from(init.headers.entries())
      : Array.isArray(init.headers)
        ? init.headers
        : Object.entries(init.headers ?? {});

  const request = {
    step,
    method: init.method ?? "GET",
    url,
    headers: Object.fromEntries(
      headersEntries.map(([key, value]) => [key, String(key).toLowerCase().includes("cookie") ? "[REDACTED]" : value])
    )
  };
  try {
    const response = await fetch(url, init);
    const body = await response.text();
    const contentType = response.headers.get("content-type") ?? "unknown";
    const preview = redactBody(body);
    if (HTTP_TRACE) {
      logger.info(
        {
          ...request,
          status: response.status,
          contentType,
          length: preview.length,
          duration_ms: Date.now() - start,
          body_preview: preview.preview
        },
        "Alexa HTTP trace"
      );
    }
    return { response, body };
  } catch (err: any) {
    logger.error({ ...request, duration_ms: Date.now() - start, err }, "Alexa HTTP request failed");
    throw err;
  }
}

async function loadCookie(logger: Logger): Promise<{ cookie: AlexaCookieData; cookieString: string; csrf?: string; macDms?: string }> {
  const macDmsEnv = process.env.ALEXA_MACDMS?.trim();
  if (process.env.ALEXA_COOKIE && process.env.ALEXA_COOKIE.trim().length > 0) {
    const cookieString = process.env.ALEXA_COOKIE.trim();
    logger.info(
      { cookie_source: "env", cookie_summary: summarizeSecret(cookieString), macDms: summarizeSecret(macDmsEnv) },
      "Loaded Alexa cookie from environment variable"
    );
    return { cookie: cookieString, cookieString, csrf: process.env.ALEXA_CSRF ?? undefined, macDms: macDmsEnv };
  }

  const cookieJsonPath = getCookiePath();
  try {
    const parsed = await loadCookieData(logger);
    const refreshed = parsed ? await maybeRefreshCookieData(parsed, logger) : null;
    const data = refreshed ?? parsed;
    if (data && refreshed) {
      await saveCookieData(cookieJsonPath, data);
    }
    const cookieString = extractCookieString(data);
    if (!cookieString) {
      throw new Error(`Cookie JSON missing 'cookie', 'localCookie', or 'loginCookie' property (${cookieJsonPath})`);
    }
    const csrf = extractCsrf(data);
    const macDms = typeof data === "object" && data !== null ? (data as any).macDms ?? macDmsEnv : macDmsEnv;
    const cookiePayload =
      typeof data === "object" && data !== null
        ? { ...data, macDms, localCookie: (data as any).localCookie ?? cookieString }
        : cookieString;

    logger.info(
      {
        cookie_source: "file",
        cookie_path: cookieJsonPath,
        cookie_summary: summarizeSecret(cookieString),
        csrf: summarizeSecret(csrf),
        macDms: summarizeSecret(macDms)
      },
      "Loaded Alexa cookie data from disk"
    );

    if (typeof cookiePayload === "object" && !cookiePayload.macDms) {
      throw new Error(
        `Alexa cookie registration data missing macDms; regenerate via 'npm run alexa:cookie:init' (${cookieJsonPath})`
      );
    }

    return { cookie: cookiePayload, cookieString, csrf, macDms };
  } catch (err: any) {
    logger.error({ err, resolved: cookieJsonPath }, "Unable to load Alexa cookie JSON file");
    if (err?.code === "ENOENT") {
      throw new Error(
        `Alexa cookie file not found at ${cookieJsonPath}. Run 'npm run alexa:cookie:init' to generate it.`
      );
    }
    throw err;
  }
}

export async function loadRoutineMap(mapPath: string, logger: Logger, checkedEnvVars: string[] = []): Promise<RoutineMap> {
  const resolved = resolveFromRepo(mapPath);
  try {
    const raw = await fs.readFile(resolved, "utf-8");
    const parsed = JSON.parse(raw);
    const mappings: RoutineMap = parsed.mappings ?? parsed;
    if (!mappings || typeof mappings !== "object") {
      throw new Error("Invalid routine map format (expected object or { mappings: { ... } })");
    }
    return mappings;
  } catch (err: any) {
    const envHint = checkedEnvVars.length > 0 ? checkedEnvVars.join(",") : "ROUTINE_MAP_PATH,ALEXA_ROUTINE_MAP_PATH";
    const example = "ROUTINE_MAP_PATH=./config/alexa.routines.json";
    const message = `Failed to load Alexa routine map from ${resolved}. Checked env vars: ${envHint}. Example: ${example}`;
    logger.error({ err, resolved, checkedEnvVars }, message);
    throw new Error(message, { cause: err });
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function initAlexaRemote(logger: Logger): Promise<{ alexa: any; routines: any[] }> {
  const alexa = new AlexaRemote();
  const { cookie, cookieString, csrf, macDms } = await loadCookie(logger);
  const amazonPage = process.env.ALEXA_AMAZON_DOMAIN ?? "amazon.com";
  const acceptLanguage = process.env.ALEXA_ACCEPT_LANGUAGE ?? "en-US";
  const userAgent = process.env.ALEXA_USER_AGENT ?? DEFAULT_USER_AGENT;
  const alexaServiceHost = (process.env.ALEXA_SERVICE_HOST ?? `alexa.${amazonPage}`).replace(/^https?:\/\//, "");
  const useWsMqtt = toBool(process.env.ALEXA_USE_WS_MQTT) ?? false;
  const initTimeoutMs = Number(process.env.ALEXA_INIT_TIMEOUT_MS ?? 120_000) || 120_000;
  const alexaRemoteLogging =
    process.env.ALEXA_REMOTE_LOGGER === "1" ||
    process.env.ALEXA_REMOTE_LOGGER?.toLowerCase() === "true" ||
    process.env.DEBUG_ALEXA === "1" ||
    process.env.DEBUG_ALEXA?.toLowerCase() === "true";

  await withTimeout(
    new Promise<void>((resolve, reject) => {
      const cookieForInit =
        typeof cookie === "object" && cookie !== null
          ? { ...cookie }
          : cookie;

      if (typeof cookieForInit === "object" && cookieForInit !== null) {
        if (typeof (cookieForInit as any).cookie === "string" && (cookieForInit as any).localCookie) {
          delete (cookieForInit as any).cookie;
        }
        (cookieForInit as any).formerRegistrationData ??= cookieForInit;
      }

      const initOptions: any = {
        cookie: cookieForInit,
        csrf,
        macDms,
        amazonPage,
        acceptLanguage,
        userAgent,
        useWsMqtt,
        alexaServiceHost,
        logger: alexaRemoteLogging ? (msg: unknown) => logger.debug({ msg: sanitizeForLogs(String(msg ?? "")) }, "alexa-remote2") : undefined
      };
      alexa.init(initOptions, (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    }),
    initTimeoutMs,
    "alexa.init"
  );

  const headers: Record<string, string> = {
    Cookie: cookieString,
    csrf: csrf ?? "",
    "User-Agent": userAgent,
    Accept: "application/json",
    "Accept-Language": acceptLanguage,
    Referer: `https://alexa.${amazonPage}/spa/index.html`,
    Origin: `https://alexa.${amazonPage}`
  };
  if (!csrf) delete headers.csrf;
  const sharedSignal = AbortSignal.timeout(initTimeoutMs);
  const baseUrl = `https://${(alexa as any).baseUrl ?? alexaServiceHost}`;

  logger.info(
    {
      amazonPage,
      alexaServiceHost: baseUrl,
      http_trace: HTTP_TRACE,
      cookie_summary: summarizeSecret(cookieString),
      csrf: summarizeSecret(csrf),
      macDms: summarizeSecret(macDms),
      useWsMqtt
    },
    "Initialized Alexa session and prepared shared HTTP client"
  );

  const canary = await tracedFetch(logger, "alexa-canary", `${baseUrl}/api/devices-v2/device?cached=true&_=${Date.now()}`, {
    method: "GET",
    headers,
    signal: sharedSignal
  });
  if (!canary.response.ok) {
    await persistHttpBody("alexa-canary-response", canary.body, logger);
    throw new Error(
      `Alexa authenticated canary failed with status ${canary.response.status} (${canary.response.statusText ?? "unknown"})`
    );
  }
  try {
    JSON.parse(canary.body);
  } catch (err) {
    await persistHttpBody("alexa-canary-response", canary.body, logger);
    throw new Error("Alexa authenticated canary returned non-JSON response");
  }

  const routinesResponse = await tracedFetch(
    logger,
    "alexa-list-routines",
    `${baseUrl}/api/behaviors/v2/automations?limit=2000`,
    {
      method: "GET",
      headers,
      signal: sharedSignal
    }
  );
  const routinesContentType = routinesResponse.response.headers.get("content-type") ?? "unknown";
  if (!routinesResponse.response.ok) {
    await persistHttpBody("alexa-routines-response", routinesResponse.body, logger);
    throw new Error(
      `Failed to fetch routines (status ${routinesResponse.response.status}, content-type ${routinesContentType})`
    );
  }

  let routineResponse: any;
  try {
    routineResponse = JSON.parse(routinesResponse.body);
  } catch (err) {
    await persistHttpBody("alexa-routines-response", routinesResponse.body, logger);
    throw new Error("Failed to parse Alexa routines response as JSON");
  }

  const routines =
    (Array.isArray(routineResponse?.automationRoutines) && routineResponse.automationRoutines) ||
    (Array.isArray(routineResponse?.routines) && routineResponse.routines) ||
    (Array.isArray(routineResponse) && routineResponse);

  if (!routines) {
    await persistHttpBody("alexa-routines-response", routinesResponse.body, logger);
    throw new Error("Unexpected Alexa routines payload shape");
  }

  if (routines.length === 0) {
    await persistHttpBody("alexa-routines-response", routinesResponse.body, logger);
    logger.warn("Alexa routines response contained zero routines");
  }

  logger.info({ routines: routines.length }, "Loaded Alexa routines");

  return { alexa, routines };
}

export function routineId(routine: any): string | undefined {
  return routine?.automationId ?? routine?.behaviorId ?? routine?.routineId ?? routine?.id;
}

export function resolveRoutine(
  routines: any[],
  target: string,
  logger: Logger,
  opts?: { quiet?: boolean }
): any | null {
  const found =
    routines.find((r) => r.name === target || r.automationName === target || routineId(r) === target) ??
    routines.find((r) => routineId(r)?.includes(target));
  if (!found && !opts?.quiet) {
    logger.warn({ target }, "Routine not found");
  }
  return found ?? null;
}

export function normalizeRoutineState(state: unknown): RoutineState {
  if (typeof state === "string") {
    return { power: state.toUpperCase() };
  }
  if (!state || typeof state !== "object") {
    return {};
  }
  const power = typeof (state as any).power === "string" ? (state as any).power : (state as any).state;
  return {
    power: typeof power === "string" ? power.toUpperCase() : undefined,
    direction: typeof (state as any).direction === "string" ? (state as any).direction.toUpperCase() : undefined,
    speed: typeof (state as any).speed === "string" ? (state as any).speed.toUpperCase() : undefined
  };
}

export function buildTransomRoutineKey(deviceId: string, state: RoutineState): string {
  if ((state.power ?? "").toUpperCase() === "OFF") {
    return `${deviceId}|OFF`.toUpperCase();
  }
  const direction = state.direction ?? "";
  const speed = state.speed ?? "";
  return `${deviceId}|${state.power ?? ""}|${direction}|${speed}`.toUpperCase();
}

export function buildPlugRoutineKey(plugId: string, state: RoutineState): string {
  return `${plugId}|${state.power ?? ""}`.toUpperCase();
}

export function describeRoutine(routine: any): { id?: string; name?: string } {
  return { id: routineId(routine), name: routine?.name ?? routine?.automationName };
}

function trimEmptySegments(key: string): string {
  const segments = key.split("|");
  while (segments.length > 0 && segments[segments.length - 1] === "") {
    segments.pop();
  }
  return segments.join("|");
}

export function buildRoutineCandidateKeys(deviceId: string, state: RoutineState): string[] {
  const normalizedDevice = deviceId.toUpperCase();
  const transomKey = buildTransomRoutineKey(normalizedDevice, state);
  const trimmed = trimEmptySegments(transomKey);
  const plugKey = buildPlugRoutineKey(normalizedDevice, state);
  const keys = [transomKey, trimmed, plugKey];
  const seen = new Set<string>();
  return keys.filter((key) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return key.length > 0;
  });
}
