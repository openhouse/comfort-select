import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import AlexaRemote from "alexa-remote2";
import type { Logger } from "pino";

export type RoutineMap = Record<string, string>;

async function loadCookie(logger: Logger): Promise<string> {
  if (process.env.ALEXA_COOKIE && process.env.ALEXA_COOKIE.trim().length > 0) {
    return process.env.ALEXA_COOKIE;
  }

  const cookieJsonPath = process.env.ALEXA_COOKIE_JSON;
  if (cookieJsonPath) {
    const resolved = path.resolve(cookieJsonPath);
    try {
      const raw = await fs.readFile(resolved, "utf-8");
      const parsed = JSON.parse(raw);
      if (typeof parsed === "string") return parsed;
      if (parsed.cookie) return parsed.cookie;
      throw new Error(`Cookie JSON missing 'cookie' property (${resolved})`);
    } catch (err: any) {
      logger.error({ err, resolved }, "Unable to load Alexa cookie JSON file");
      throw err;
    }
  }

  throw new Error("ALEXA_COOKIE or ALEXA_COOKIE_JSON is required for alexa-remote2");
}

export async function loadRoutineMap(mapPath: string, logger: Logger): Promise<RoutineMap> {
  const resolved = path.resolve(mapPath);
  try {
    const raw = await fs.readFile(resolved, "utf-8");
    const parsed = JSON.parse(raw);
    const mappings: RoutineMap = parsed.mappings ?? parsed;
    if (!mappings || typeof mappings !== "object") {
      throw new Error("Invalid routine map format (expected object or { mappings: { ... } })");
    }
    return mappings;
  } catch (err: any) {
    logger.warn({ err, mapPath: resolved }, "Falling back to empty routine map");
    return {};
  }
}

export async function initAlexaRemote(logger: Logger): Promise<{ alexa: any; routines: any[] }> {
  const alexa = new AlexaRemote();
  const cookie = await loadCookie(logger);
  const amazonPage = process.env.ALEXA_AMAZON_DOMAIN ?? "amazon.com";
  const userAgent = process.env.ALEXA_USER_AGENT ?? "comfort-select-actuator-bridge";

  await new Promise<void>((resolve, reject) => {
    alexa.init(
      {
        cookie,
        amazonPage,
        acceptLanguage: "en-US",
        userAgent,
        useWsMqtt: false
      },
      (err: any) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });

  const getAutomationRoutines = promisify(alexa.getAutomationRoutines).bind(alexa);
  const routineResponse = await getAutomationRoutines(2000);
  const routines = Array.isArray(routineResponse?.automationRoutines)
    ? routineResponse.automationRoutines
    : Array.isArray(routineResponse?.routines)
      ? routineResponse.routines
      : Array.isArray(routineResponse)
        ? routineResponse
        : [];

  logger.info({ routines: routines.length }, "Loaded Alexa routines");

  return { alexa, routines };
}

export function routineId(routine: any): string | undefined {
  return routine?.automationId ?? routine?.behaviorId ?? routine?.routineId ?? routine?.id;
}

export function resolveRoutine(routines: any[], target: string, logger: Logger): any | null {
  const found =
    routines.find((r) => r.name === target || r.automationName === target || routineId(r) === target) ??
    routines.find((r) => routineId(r)?.includes(target));
  if (!found) {
    logger.warn({ target }, "Routine not found");
  }
  return found ?? null;
}

export function buildTransomRoutineKey(deviceId: string, state: { power?: string; direction?: string; speed?: string }): string {
  if ((state.power ?? "").toUpperCase() === "OFF") {
    return `${deviceId}|OFF`.toUpperCase();
  }
  const direction = state.direction ?? "";
  const speed = state.speed ?? "";
  return `${deviceId}|${state.power ?? ""}|${direction}|${speed}`.toUpperCase();
}

export function buildPlugRoutineKey(plugId: string, state: { power?: string }): string {
  return `${plugId}|${state.power ?? ""}`.toUpperCase();
}

export function describeRoutine(routine: any): { id?: string; name?: string } {
  return { id: routineId(routine), name: routine?.name ?? routine?.automationName };
}
