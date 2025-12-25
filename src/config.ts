import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const EnvSchema = z.object({
  CYCLE_MINUTES: z.coerce.number().int().positive().default(5),
  TIMEZONE: z.string().default("America/New_York"),

  HOME_LAT: z.coerce.number(),
  HOME_LON: z.coerce.number(),

  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default("gpt-5.2"),

  PROMPT_TEMPLATE_PATH: z.string().default("./config/prompt/llm-prompt-template.md.hbs"),
  SITE_CONFIG_PATH: z.string().default("./config/site.config.json"),
  CURATORS_JSON: z.string().optional(),

  GOOGLE_SHEETS_SPREADSHEET_ID: z.string().min(1),
  GOOGLE_SHEETS_SHEET_NAME: z.string().default("TimeSeries"),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().min(1),

  HISTORY_MODE: z.enum(["full", "window"]).default("window"),
  HISTORY_ROWS: z.coerce.number().int().positive().default(200),
  PROMPT_MAX_CHARS: z.coerce.number().int().positive().default(120_000),
  SHEET_SYNC_ROWS: z.coerce.number().int().positive().default(2000),

  HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  ECOWITT_SOURCE: z.enum(["mock", "local_gateway", "cloud_api"]).default("mock"),
  ECOWITT_GATEWAY_URL: z.string().optional(),
  ECOWITT_MAPPING_JSON: z.string().default("./config/sensors.mapping.json"),
  ECOWITT_CLOUD_APPLICATION_KEY: z.string().optional(),
  ECOWITT_CLOUD_API_KEY: z.string().optional(),
  ECOWITT_CLOUD_DEVICE_MAC: z.string().optional(),

  DRY_RUN: z
    .string()
    .default("true")
    .transform((v) => v.toLowerCase() === "true"),

  ALEXA_WEBHOOK_URL: z.string().optional(),
  ALEXA_WEBHOOK_TOKEN: z.string().optional(),

  MEROSS_WEBHOOK_URL: z.string().optional(),
  MEROSS_WEBHOOK_TOKEN: z.string().optional(),

  MONGODB_URI: z.string().optional(),
  MONGO_URL: z.string().optional(),
  MONGODB_DB_NAME: z.string().default("comfort_select"),
  MONGODB_COLLECTION: z.string().default("cycle_records"),

  PORT: z.coerce.number().int().positive().default(3000)
});

export type AppConfig = Omit<z.infer<typeof EnvSchema>, "MONGO_URL"> & { MONGODB_URI: string };

export function loadConfig(): AppConfig {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error(parsed.error.format());
    throw new Error("Invalid environment configuration");
  }
  const raw = parsed.data;
  const uri = raw.MONGODB_URI ?? raw.MONGO_URL;
  if (!uri) {
    throw new Error("MONGODB_URI (or MONGO_URL) is required");
  }
  const { MONGO_URL, ...rest } = raw;
  return { ...rest, MONGODB_URI: uri };
}
