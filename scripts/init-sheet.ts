import { loadConfig } from "../src/config.js";
import { ensureHeaderRow } from "../src/adapters/store/googleSheetsStore.js";
import { logger } from "../src/utils/logger.js";
import { loadPromptAssetsFromConfig } from "../src/promptAssets.js";
import { buildSheetHeader } from "../src/adapters/store/googleSheetsStore.js";

const cfg = loadConfig();
const promptAssets = loadPromptAssetsFromConfig(cfg);
const header = buildSheetHeader(promptAssets.siteConfig);

await ensureHeaderRow({
  spreadsheetId: cfg.GOOGLE_SHEETS_SPREADSHEET_ID,
  sheetName: cfg.GOOGLE_SHEETS_SHEET_NAME,
  serviceAccountJsonPath: cfg.GOOGLE_SERVICE_ACCOUNT_JSON
}, header);

logger.info("Sheet header verified");
