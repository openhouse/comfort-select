import { loadConfig } from "../src/config.js";
import { runCycleOnce } from "../src/cycle.js";
import { logger } from "../src/utils/logger.js";

const cfg = loadConfig();

const rec = await runCycleOnce(cfg);
logger.info({ timestamp: rec.timestamp_utc_iso }, "Ran one cycle");
