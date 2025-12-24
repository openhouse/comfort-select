import { loadConfig } from "../src/config.js";
import { ensureHeaderRow } from "../src/adapters/store/googleSheetsStore.js";
import { logger } from "../src/utils/logger.js";

const cfg = loadConfig();

await ensureHeaderRow({
  spreadsheetId: cfg.GOOGLE_SHEETS_SPREADSHEET_ID,
  sheetName: cfg.GOOGLE_SHEETS_SHEET_NAME,
  serviceAccountJsonPath: cfg.GOOGLE_SERVICE_ACCOUNT_JSON
});

logger.info("Sheet header verified");
