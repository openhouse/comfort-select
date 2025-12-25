import { loadConfig } from "../src/config.js";
import { loadPromptAssetsFromConfig } from "../src/promptAssets.js";
import { buildSheetHeader, cycleRecordToRow, overwriteSheet } from "../src/adapters/store/googleSheetsStore.js";
import { getRecentCycleRecords, initMongo } from "../src/adapters/store/mongoStore.js";
import { logger } from "../src/utils/logger.js";

const cfg = loadConfig();
const promptAssets = loadPromptAssetsFromConfig(cfg);
const sheetHeader = buildSheetHeader(promptAssets.siteConfig);

const mongoStore = await initMongo({
  uri: cfg.MONGODB_URI,
  dbName: cfg.MONGODB_DB_NAME,
  collectionName: cfg.MONGODB_COLLECTION
});
const rowsForSheet = await getRecentCycleRecords(mongoStore, cfg.SHEET_SYNC_ROWS);
const projectedRows = rowsForSheet.map((rec) => cycleRecordToRow(rec, promptAssets.siteConfig, sheetHeader));

await overwriteSheet(
  {
    spreadsheetId: cfg.GOOGLE_SHEETS_SPREADSHEET_ID,
    sheetName: cfg.GOOGLE_SHEETS_SHEET_NAME,
    serviceAccountJsonPath: cfg.GOOGLE_SERVICE_ACCOUNT_JSON
  },
  [sheetHeader, ...projectedRows]
);

logger.info({ rows: projectedRows.length }, "Sheet rebuilt from MongoDB snapshot");
