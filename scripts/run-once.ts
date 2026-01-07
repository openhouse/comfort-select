import { loadConfig } from "../src/config.js";
import { runCycleOnce } from "../src/cycle.js";
import { logger } from "../src/utils/logger.js";
import { loadPromptAssetsFromConfig } from "../src/promptAssets.js";

const cfg = loadConfig();
const promptAssets = loadPromptAssetsFromConfig(cfg);

const rec = await runCycleOnce(cfg, promptAssets);
logger.info({ timestamp: rec.timestamp_utc_iso }, "Ran one cycle");
