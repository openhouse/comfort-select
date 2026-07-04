import express from "express";
import { CycleRecord } from "./types.js";
import { logger } from "./utils/logger.js";

export function startServer(params: { port: number; getLast: () => CycleRecord | null }) {
  const app = express();

  app.get("/healthz", (_req, res) => {
    const last = params.getLast();
    res.json({
      ok: true,
      last_cycle_utc: last?.timestamp_utc_iso ?? null,
      last_cycle_local: last?.timestamp_local_iso ?? null,
      last_confidence: last?.decision.confidence_0_1 ?? null,
      last_data_errors: last?.data_errors ?? null,
      last_data_warnings: last?.data_warnings ?? null,
      last_decision_errors: last?.decision_errors ?? null,
      last_actuation_errors: last?.actuation_errors ?? last?.actuation.errors ?? null,
      last_cycle_warnings: last?.cycle_warnings ?? null,
      last_actuation_ok: last?.actuation.actuation_ok ?? null,
      last_decision_id: last?.decision_id ?? null
    });
  });

  app.get("/last-decision", (_req, res) => {
    const last = params.getLast();
    if (!last) return res.status(404).json({ ok: false, error: "no cycles yet" });
    res.json({
      timestamp_utc: last.timestamp_utc_iso,
      decision_id: last.decision_id,
      decision: last.decision,
      data_errors: last.data_errors,
      data_warnings: last.data_warnings,
      decision_errors: last.decision_errors,
      actuation_errors: last.actuation_errors,
      cycle_warnings: last.cycle_warnings,
      actuation: last.actuation
    });
  });

  const server = app.listen(params.port, () => {
    logger.info({ port: params.port }, "HTTP server listening");
  });

  return server;
}
