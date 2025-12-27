import express from "express";
import { promisify } from "node:util";
import pino from "pino";
import { resolveFromRepo } from "./env.js";
import {
  buildPlugRoutineKey,
  buildTransomRoutineKey,
  describeRoutine,
  initAlexaRemote,
  loadRoutineMap,
  resolveRoutine
} from "./lib.js";

const logger = pino({ name: "actuator-bridge" });

const ALEXA_TOKEN = process.env.ALEXA_WEBHOOK_TOKEN;
const MEROSS_TOKEN = process.env.MEROSS_WEBHOOK_TOKEN;
const ROUTINE_DEVICE = process.env.ALEXA_ROUTINE_DEVICE_NAME ?? "ALEXA_CURRENT_DEVICE";
const MAP_PATH = resolveFromRepo(process.env.ALEXA_ROUTINE_MAP_PATH ?? "./config/alexa.routines.json");
const PORT = Number(process.env.ACTUATOR_BRIDGE_PORT ?? 8787);
const COOLDOWN_MS = Number(process.env.ALEXA_ROUTINE_COOLDOWN_MS ?? 120_000) || 120_000;

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

async function main() {
  const { alexa, routines } = await initAlexaRemote(logger);
  const routineMap = await loadRoutineMap(MAP_PATH, logger);

  const executeRoutine = promisify(alexa.executeAutomationRoutine).bind(alexa) as (
    serialOrName: string,
    routine: any
  ) => Promise<void>;

  const lastApplied = new Map<string, { key: string; ts: number }>();

  const app = express();
  app.use(express.json({ limit: "256kb" }));

  app.get("/healthz", (_req, res) => {
    res.json({
      ok: true,
      routines: routines.length,
      mapped: Object.keys(routineMap).length,
      cooldown_ms: COOLDOWN_MS
    });
  });

  app.post("/alexa", requireToken(ALEXA_TOKEN), async (req, res) => {
    const { device, state, decision_id, correlationId } = req.body ?? {};
    if (!device || !state) {
      return res.status(400).json({ ok: false, error: "device and state are required" });
    }

    const routineKey = buildTransomRoutineKey(device, state);
    const routineName = routineMap[routineKey];
    if (!routineName) {
      return res
        .status(404)
        .json({ ok: false, error: `No routine mapping for key ${routineKey}`, correlationId: decision_id ?? correlationId });
    }

    const routine = resolveRoutine(routines, routineName, logger);
    if (!routine) {
      return res.status(404).json({ ok: false, error: `Routine not found: ${routineName}`, correlationId: decision_id ?? correlationId });
    }

    if (shouldSkip(device, routineKey, lastApplied)) {
      logger.info({ device, routineKey }, "Skipping duplicate actuation (cooldown)");
      return res.json({
        ok: true,
        skipped: true,
        correlationId: decision_id ?? correlationId,
        routineInvoked: describeRoutine(routine)
      });
    }

    try {
      await executeRoutine(ROUTINE_DEVICE, routine);
      lastApplied.set(device, { key: routineKey, ts: Date.now() });
      logger.info({ device, routineKey, routine: describeRoutine(routine) }, "Executed Alexa routine");
      return res.json({
        ok: true,
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

  app.post("/meross", requireToken(MEROSS_TOKEN), async (req, res) => {
    const { plug, state, decision_id, correlationId } = req.body ?? {};
    if (!plug || !state) {
      return res.status(400).json({ ok: false, error: "plug and state are required" });
    }

    const routineKey = buildPlugRoutineKey(plug, state);
    const routineName = routineMap[routineKey];
    if (!routineName) {
      return res
        .status(404)
        .json({ ok: false, error: `No routine mapping for key ${routineKey}`, correlationId: decision_id ?? correlationId });
    }

    const routine = resolveRoutine(routines, routineName, logger);
    if (!routine) {
      return res.status(404).json({ ok: false, error: `Routine not found: ${routineName}`, correlationId: decision_id ?? correlationId });
    }

    if (shouldSkip(plug, routineKey, lastApplied)) {
      logger.info({ plug, routineKey }, "Skipping duplicate plug actuation (cooldown)");
      return res.json({
        ok: true,
        skipped: true,
        correlationId: decision_id ?? correlationId,
        routineInvoked: describeRoutine(routine)
      });
    }

    try {
      await executeRoutine(ROUTINE_DEVICE, routine);
      lastApplied.set(plug, { key: routineKey, ts: Date.now() });
      logger.info({ plug, routineKey, routine: describeRoutine(routine) }, "Executed Meross routine via Alexa");
      return res.json({
        ok: true,
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
  });

  app.listen(PORT, () => {
    logger.info({ port: PORT, routineDevice: ROUTINE_DEVICE, mapPath: MAP_PATH }, "Actuator bridge listening");
  });
}

main().catch((err) => {
  logger.error({ err }, "Actuator bridge failed to start");
  process.exit(1);
});
