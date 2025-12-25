import { loadConfig } from "./config.js";
import { logger } from "./utils/logger.js";
import { runCycleOnce } from "./cycle.js";
import { startServer } from "./server.js";
import type { CycleRecord } from "./types.js";
import { loadPromptAssetsFromConfig } from "./promptAssets.js";

const cfg = loadConfig();
const promptAssets = loadPromptAssetsFromConfig(cfg);

let last: CycleRecord | null = null;
let running = false;

startServer({
  port: cfg.PORT,
  getLast: () => last
});

async function tick() {
  if (running) {
    logger.warn("Cycle skipped: previous cycle still running");
    return;
  }
  running = true;
  try {
    last = await runCycleOnce(cfg, promptAssets);
  } catch (e: any) {
    logger.error({ err: e }, "Cycle crashed");
  } finally {
    running = false;
  }
}

const intervalMs = cfg.CYCLE_MINUTES * 60_000;

logger.info(
  { cycle_minutes: cfg.CYCLE_MINUTES, dry_run: cfg.DRY_RUN },
  "Starting comfort control loop"
);

// Run immediately, then on interval.
void tick();
setInterval(() => void tick(), intervalMs);
