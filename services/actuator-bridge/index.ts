import express from "express";
import path from "node:path";
import { promisify } from "node:util";
import pino from "pino";
import { resolveFromRepo } from "./env.js";
import {
  RoutineMap,
  RoutineState,
  buildRoutineCandidateKeys,
  describeRoutine,
  fetchAlexaDevices,
  initAlexaRemote,
  loadRoutineMap,
  normalizeRoutineState,
  routineId,
  resolveRoutine
} from "./lib.js";

const redactionPaths = [
  "*.headers.cookie",
  "*.headers.authorization",
  "*.Cookie",
  "*.cookie",
  "*.access_token",
  "*.refresh_token",
  "*.session-token",
  "*.sessionToken",
  "*.csrf",
  "*.frc",
  "*.map-md",
  "*.device_private_key",
  "*.adp_token",
  "*.macDms.device_private_key"
];

const pretty =
  process.env.NODE_ENV !== "production"
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname"
        }
      }
    : undefined;

const logger = pino(
  {
    name: "actuator-bridge",
    level: process.env.LOG_LEVEL ?? "info",
    redact: { paths: redactionPaths, censor: "[REDACTED]" }
  },
  pretty ? (pino.transport(pretty) as any) : undefined
);

const ALEXA_TOKEN = process.env.ALEXA_WEBHOOK_TOKEN;
const MEROSS_TOKEN = process.env.MEROSS_WEBHOOK_TOKEN;
const ROUTINE_DEVICE_NAME =
  process.env.ALEXA_ROUTINE_DEVICE_NAME ?? process.env.ALEXA_ROUTINE_DEVICE ?? "ALEXA_CURRENT_DEVICE";
const ROUTINE_DEVICE_SERIAL = process.env.ALEXA_ROUTINE_DEVICE_SERIAL;
const ROUTINE_MAP_ENV_VARS = ["ROUTINE_MAP_PATH", "ALEXA_ROUTINE_MAP_PATH"] as const;
const DEFAULT_ROUTINE_MAP_PATH = path.join(process.cwd(), "config", "alexa.routines.json");
const MAP_PATH = resolveFromRepo(
  process.env.ROUTINE_MAP_PATH ?? process.env.ALEXA_ROUTINE_MAP_PATH ?? DEFAULT_ROUTINE_MAP_PATH
);
const portEnv = process.env.ACTUATOR_BRIDGE_PORT ?? process.env.PORT;
const PORT = Number(portEnv ?? 8787);
const COOLDOWN_MS = Number(process.env.ALEXA_ROUTINE_COOLDOWN_MS ?? 120_000) || 120_000;
const INIT_RETRY_MS = Number(process.env.ALEXA_INIT_RETRY_MS ?? 30_000) || 30_000;
const envVarsChecked = ROUTINE_MAP_ENV_VARS.filter((key) => process.env[key] !== undefined);

function requireToken(expected?: string) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!expected) {
      return res.status(401).json({ ok: false, error: "Missing bearer token configuration" });
    }
    const header = req.headers.authorization;
    if (!header || !header.toLowerCase().startsWith("bearer ")) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    const token = header.slice("bearer ".length);
    if (token !== expected) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    next();
  };
}

function shouldSkip(deviceId: string, routineKey: string, cache: Map<string, { key: string; ts: number }>) {
  const entry = cache.get(deviceId);
  if (!entry) return false;
  const withinCooldown = Date.now() - entry.ts < COOLDOWN_MS;
  return withinCooldown && entry.key === routineKey;
}

function requireReady() {
  return (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    const { ready, alexaReady: alexaUp, routineMapReady: mapReady, routineDeviceReady: deviceReady } = readyState();
    if (!ready) {
      return res.status(503).json({
        ok: false,
        ready,
        alexaReady: alexaUp,
        routineMapReady: mapReady,
        routineDeviceReady: deviceReady,
        error: lastInitError ?? "actuator_bridge_not_ready"
      });
    }
    next();
  };
}

const app = express();
app.use(express.json({ limit: "256kb" }));

let alexaReady = false;
let routineMapReady = false;
let routineDeviceReady = false;
let lastInitError: string | null = null;
let alexa: any | null = null;
let routines: any[] = [];
let routineMap: RoutineMap = {};
let executeRoutine: ((serialOrName: string, routineId: string) => Promise<void>) | null = null;
let initializing = false;
let alexaDevices: any[] = [];
let routineDeviceResolved: any | null = null;
let routineDeviceFound = false;
let routineDeviceSamples: Array<{ accountName?: string; serialNumber?: string }> = [];
let routineDeviceTarget: string | null = null;
let routineValidation: { missing: Array<{ key: string; target: string }>; resolved: number; total: number } = {
  missing: [],
  resolved: 0,
  total: 0
};

const lastApplied = new Map<string, { key: string; ts: number }>();

function readyState() {
  const ready = alexaReady && routineMapReady && routineDeviceReady;
  return { ready, alexaReady, routineMapReady, routineDeviceReady, lastInitError };
}

function normalizeIdentifier(value: string | undefined | null): string | undefined {
  return value?.trim().toLowerCase();
}

function summarizeDevice(device: any) {
  if (!device) return null;
  return {
    accountName: device.accountName ?? device.name,
    serialNumber: device.serialNumber,
    deviceType: device.deviceType ?? device.deviceFamily ?? device.type
  };
}

function validateRoutineMap(map: RoutineMap, discoveredRoutines: any[]): void {
  const missing: Array<{ key: string; target: string }> = [];
  let resolved = 0;
  for (const [key, target] of Object.entries(map)) {
    const routine = resolveRoutine(discoveredRoutines, target, logger, { quiet: true });
    if (routine) resolved += 1;
    else missing.push({ key, target });
  }

  routineValidation = { missing, resolved, total: Object.keys(map).length };

  if (missing.length > 0) {
    logger.warn(
      {
        missingMappingsCount: missing.length,
        missingMappingsSample: missing.slice(0, 5),
        totalMappings: Object.keys(map).length,
        routinesDiscovered: discoveredRoutines.length
      },
      "Routine map contains entries that were not found among loaded routines"
    );
  } else {
    logger.info({ totalMappings: Object.keys(map).length }, "All routine map entries resolved against loaded routines");
  }
}

function pickRoutineMapping(deviceId: string, state: RoutineState): {
  routineKey?: string;
  routineTarget?: string;
  candidateKeys: string[];
  normalizedState: RoutineState;
} {
  const normalizedState = normalizeRoutineState(state);
  const candidateKeys = buildRoutineCandidateKeys(deviceId, normalizedState);
  for (const key of candidateKeys) {
    const target = routineMap[key];
    if (target) {
      return { routineKey: key, routineTarget: target, candidateKeys, normalizedState };
    }
  }
  return { candidateKeys, normalizedState };
}

function resolveRoutineDevice(devices: any[]): { device: any | null; found: boolean; target: string | null } {
  const identifiers = [
    ROUTINE_DEVICE_SERIAL,
    ROUTINE_DEVICE_NAME,
    ROUTINE_DEVICE_NAME === "ALEXA_CURRENT_DEVICE" ? undefined : "ALEXA_CURRENT_DEVICE"
  ].filter(Boolean) as string[];

  const normalized = identifiers.map(normalizeIdentifier);
  const match =
    devices.find((d) => {
      const name = normalizeIdentifier(d.accountName ?? d.name);
      const serial = normalizeIdentifier(d.serialNumber);
      return normalized.includes(name) || normalized.includes(serial);
    }) ?? null;

  const targetDevice = match ?? (devices.length > 0 ? devices[0] : null);
  const found = Boolean(match);
  const target = targetDevice
    ? targetDevice.serialNumber ?? targetDevice.accountName ?? targetDevice.name ?? ROUTINE_DEVICE_NAME
    : null;

  return { device: targetDevice, found, target };
}

app.get("/healthz", (_req, res) => {
  const { ready } = readyState();
  res.json({
    ok: true,
    ready,
    alexaReady,
    routineMapReady,
    routineDeviceReady,
    lastInitError,
    routines: routines.length,
    devices: alexaDevices.length,
    routineDeviceConfiguredName: ROUTINE_DEVICE_NAME,
    routineDeviceConfiguredSerial: ROUTINE_DEVICE_SERIAL,
    routineDeviceFound,
    routineDeviceResolved: summarizeDevice(routineDeviceResolved),
    routineDeviceSamples,
    mapped: Object.keys(routineMap).length,
    mapped_resolved: routineValidation.resolved,
    mapped_missing: routineValidation.missing.length,
    cooldown_ms: COOLDOWN_MS,
    port: PORT
  });
});

app.get("/readyz", (_req, res) => {
  const { ready } = readyState();
  const body = {
    ok: ready,
    ready,
    alexaReady,
    routineMapReady,
    routineDeviceReady,
    lastInitError,
    routines: routines.length,
    devices: alexaDevices.length,
    routineDeviceConfiguredName: ROUTINE_DEVICE_NAME,
    routineDeviceConfiguredSerial: ROUTINE_DEVICE_SERIAL,
    routineDeviceFound,
    routineDeviceResolved: summarizeDevice(routineDeviceResolved),
    routineDeviceSamples,
    mapped: Object.keys(routineMap).length,
    mapped_resolved: routineValidation.resolved,
    mapped_missing: routineValidation.missing.length
  };
  if (!ready) return res.status(503).json(body);
  return res.json(body);
});

app.get("/alexa/devices", requireToken(ALEXA_TOKEN), (_req, res) => {
  const { ready } = readyState();
  return res.json({
    ok: true,
    ready,
    devicesCount: alexaDevices.length,
    devices: alexaDevices.map(summarizeDevice),
    routineDeviceConfiguredName: ROUTINE_DEVICE_NAME,
    routineDeviceConfiguredSerial: ROUTINE_DEVICE_SERIAL,
    routineDeviceFound,
    routineDeviceResolved: summarizeDevice(routineDeviceResolved),
    routineDeviceTarget,
    routineDeviceReady,
    routineDeviceSamples
  });
});

app.post("/alexa", requireToken(ALEXA_TOKEN), requireReady(), async (req, res) => {
  const { device: deviceRaw, plug: plugRaw, state, decision_id, correlationId } = req.body ?? {};
  const device = (deviceRaw ?? plugRaw)?.toString();
  const deviceId = device?.toUpperCase();

  if (!deviceId || state === undefined) {
    return res.status(400).json({ ok: false, error: "device and state are required" });
  }

  const { routineKey, routineTarget, candidateKeys, normalizedState } = pickRoutineMapping(deviceId, state);
  if (!routineKey || !routineTarget) {
    return res.status(404).json({
      ok: false,
      error: `No routine mapping for keys ${candidateKeys.join(",")}`,
      candidateKeys,
      normalizedState,
      correlationId: decision_id ?? correlationId
    });
  }

  const routine = resolveRoutine(routines, routineTarget, logger);
  if (!routine) {
    return res
      .status(404)
      .json({ ok: false, error: `Routine not found: ${routineTarget}`, correlationId: decision_id ?? correlationId });
  }

  if (shouldSkip(deviceId, routineKey, lastApplied)) {
    logger.info({ device: deviceId, routineKey }, "Skipping duplicate actuation (cooldown)");
    return res.json({
      ok: true,
      skipped: true,
      correlationId: decision_id ?? correlationId,
      routineInvoked: describeRoutine(routine)
    });
  }

  try {
    if (!executeRoutine) throw new Error("Alexa client not ready");
    const routineIdentifier = routineId(routine);
    if (!routineIdentifier) {
      return res
        .status(500)
        .json({ ok: false, error: "resolved_routine_missing_id", correlationId: decision_id ?? correlationId });
    }
    await executeRoutine(routineDeviceTarget ?? ROUTINE_DEVICE_NAME, routineIdentifier);
    lastApplied.set(deviceId, { key: routineKey, ts: Date.now() });
    logger.info(
      {
        device: deviceId,
        routineKey,
        routine: describeRoutine(routine),
        routineDevice: routineDeviceTarget ?? ROUTINE_DEVICE_NAME
      },
      "Executed Alexa routine"
    );
    return res.json({
      ok: true,
      routineKey,
      correlationId: decision_id ?? correlationId,
      routineInvoked: describeRoutine(routine)
    });
  } catch (err: any) {
    logger.error({ err, device, routineKey }, "Routine execution failed");
    return res.status(502).json({
      ok: false,
      error: err?.message ?? String(err),
      correlationId: decision_id ?? correlationId
    });
  }
});

app.post(
  "/meross",
  requireToken(MEROSS_TOKEN),
  requireReady(),
  async (req, res) => {
    const { plug: plugRaw, device: deviceRaw, state, decision_id, correlationId } = req.body ?? {};
    const plug = (plugRaw ?? deviceRaw)?.toString();
    const plugId = plug?.toUpperCase();
    if (!plugId || state === undefined) {
      return res.status(400).json({ ok: false, error: "plug and state are required" });
    }

    const { routineKey, routineTarget, candidateKeys, normalizedState } = pickRoutineMapping(plugId, state);
    if (!routineKey || !routineTarget) {
      return res.status(404).json({
        ok: false,
        error: `No routine mapping for keys ${candidateKeys.join(",")}`,
        candidateKeys,
        normalizedState,
        correlationId: decision_id ?? correlationId
      });
    }

    const routine = resolveRoutine(routines, routineTarget, logger);
    if (!routine) {
      return res
        .status(404)
        .json({ ok: false, error: `Routine not found: ${routineTarget}`, correlationId: decision_id ?? correlationId });
    }

    if (shouldSkip(plugId, routineKey, lastApplied)) {
      logger.info({ plug: plugId, routineKey }, "Skipping duplicate plug actuation (cooldown)");
      return res.json({
        ok: true,
        skipped: true,
        correlationId: decision_id ?? correlationId,
        routineInvoked: describeRoutine(routine)
      });
    }

    try {
      if (!executeRoutine) throw new Error("Alexa client not ready");
      const routineIdentifier = routineId(routine);
      if (!routineIdentifier) {
        return res
          .status(500)
          .json({ ok: false, error: "resolved_routine_missing_id", correlationId: decision_id ?? correlationId });
      }
      await executeRoutine(routineDeviceTarget ?? ROUTINE_DEVICE_NAME, routineIdentifier);
      lastApplied.set(plugId, { key: routineKey, ts: Date.now() });
      logger.info(
        {
          plug: plugId,
          routineKey,
          routine: describeRoutine(routine),
          routineDevice: routineDeviceTarget ?? ROUTINE_DEVICE_NAME
        },
        "Executed Meross routine via Alexa"
      );
      return res.json({
        ok: true,
        routineKey,
        correlationId: decision_id ?? correlationId,
        routineInvoked: describeRoutine(routine)
      });
    } catch (err: any) {
      logger.error({ err, plug, routineKey }, "Routine execution failed");
      return res.status(502).json({
        ok: false,
        error: err?.message ?? String(err),
        correlationId: decision_id ?? correlationId
      });
    }
  }
);

app.listen(PORT, () => {
  logger.info(
    { port: PORT, routineDevice: ROUTINE_DEVICE_NAME, routineDeviceSerial: ROUTINE_DEVICE_SERIAL, mapPath: MAP_PATH },
    "Actuator bridge listening"
  );
});

async function initialize() {
  if (initializing) return;
  initializing = true;
  const mapHint = envVarsChecked.length > 0 ? envVarsChecked : ["ROUTINE_MAP_PATH", "ALEXA_ROUTINE_MAP_PATH"];
  logger.info({ mapPath: MAP_PATH }, "Initializing Alexa actuator bridge");
  try {
    const alexaInit = await initAlexaRemote(logger);
    alexa = alexaInit.alexa;
    routines = alexaInit.routines ?? [];
    executeRoutine = promisify(alexa.executeAutomationRoutine).bind(alexa) as (
      serialOrName: string,
      routineId: string
    ) => Promise<void>;

    alexaDevices = await fetchAlexaDevices(alexa, logger);
    routineDeviceSamples = alexaDevices.slice(0, 5).map((d) => ({
      accountName: d.accountName ?? d.name,
      serialNumber: d.serialNumber
    }));

    if (alexaDevices.length === 0) {
      throw new Error("routine_device_not_found: no devices returned by getDevices()");
    }

    const routineDeviceSelection = resolveRoutineDevice(alexaDevices);
    routineDeviceResolved = routineDeviceSelection.device;
    routineDeviceFound = routineDeviceSelection.found;
    routineDeviceTarget = routineDeviceSelection.target;
    routineDeviceReady = Boolean(routineDeviceResolved && routineDeviceTarget);
    if (!routineDeviceFound) {
      logger.warn(
        {
          routineDeviceConfiguredName: ROUTINE_DEVICE_NAME,
          routineDeviceConfiguredSerial: ROUTINE_DEVICE_SERIAL,
          routineDeviceTarget,
          routineDeviceSamples
        },
        "Configured routine device not found; using fallback"
      );
    }
    alexaReady = true;

    routineMap = await loadRoutineMap(MAP_PATH, logger, mapHint);
    validateRoutineMap(routineMap, routines);
    routineMapReady = true;
    lastInitError = null;
    logger.info(
      {
        routines: routines.length,
        mapped: Object.keys(routineMap).length,
        routineDeviceConfiguredName: ROUTINE_DEVICE_NAME,
        routineDeviceConfiguredSerial: ROUTINE_DEVICE_SERIAL,
        routineDeviceTarget,
        routineDeviceFound
      },
      "Actuator bridge ready"
    );
  } catch (err: any) {
    alexaReady = false;
    routineMapReady = false;
    routineDeviceReady = false;
    alexaDevices = [];
    routineDeviceSamples = [];
    routineDeviceResolved = null;
    routineDeviceFound = false;
    routineDeviceTarget = null;
    lastInitError = err?.message ?? String(err);
    logger.error({ err, mapPath: MAP_PATH }, "Actuator bridge initialization failed");
    initializing = false;
    setTimeout(() => {
      logger.warn({ retry_ms: INIT_RETRY_MS }, "Retrying actuator bridge initialization");
      void initialize();
    }, INIT_RETRY_MS);
    return;
  }
  initializing = false;
}

void initialize();
