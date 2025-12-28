import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import type { Logger } from "pino";
import { resolveFromRepo } from "./env.js";

const require = createRequire(import.meta.url);
// alexa-cookie2 is CommonJS
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AlexaCookie: any = require("alexa-cookie2");

export type AlexaCookieData =
  | string
  | {
      cookie?: string;
      localCookie?: string;
      loginCookie?: string;
      csrf?: string;
      crsf?: string;
      refreshToken?: string;
      tokenDate?: string;
      [key: string]: any;
    };

const DEFAULT_COOKIE_PATH = "./config/secrets/alexa-cookie.json";
const TOKEN_REDACTION_REGEX = /(session|token|cookie|atna|atnr)[^\\s\"']*/gi;

export function getCookiePath(): string {
  const envPath = process.env.ALEXA_COOKIE_PATH ?? process.env.ALEXA_COOKIE_JSON ?? DEFAULT_COOKIE_PATH;
  return resolveFromRepo(envPath);
}

export async function loadCookieData(logger?: Logger): Promise<AlexaCookieData | undefined> {
  const cookiePath = getCookiePath();
  try {
    const raw = await fs.readFile(cookiePath, "utf-8");
    return JSON.parse(raw) as AlexaCookieData;
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      logger?.warn({ cookiePath }, "Alexa cookie file not found");
    } else {
      logger?.error({ err, cookiePath }, "Unable to read Alexa cookie file");
    }
    throw err;
  }
}

export async function saveCookieData(filePath: string, data: AlexaCookieData): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), { encoding: "utf-8", mode: 0o600 });
}

export function extractCookieString(data: AlexaCookieData | undefined): string | null {
  if (!data) return null;
  if (typeof data === "string") return data;
  if (typeof data.cookie === "string") return data.cookie;
  if (typeof data.localCookie === "string") return data.localCookie;
  if (typeof data.loginCookie === "string") return data.loginCookie;
  return null;
}

export function extractCsrf(data: AlexaCookieData | undefined): string | undefined {
  if (!data || typeof data === "string") return undefined;
  return data.csrf ?? data.crsf;
}

export async function maybeRefreshCookieData(data: AlexaCookieData, logger?: Logger): Promise<AlexaCookieData | null> {
  if (!data || typeof data === "string") return null;
  if (typeof AlexaCookie.refreshAlexaCookie !== "function") return null;
  if (!data.refreshToken || !data.loginCookie) return null;

  const debugAlexa = (process.env.DEBUG_ALEXA === "1" || process.env.DEBUG_ALEXA?.toLowerCase() === "true") ?? false;
  const sanitize = (msg: unknown) => String(msg ?? "").replace(TOKEN_REDACTION_REGEX, "[REDACTED]");

  const options = {
    formerRegistrationData: data,
    amazonPage: process.env.ALEXA_AMAZON_DOMAIN ?? process.env.ALEXA_AMAZON_PAGE ?? "amazon.com",
    baseAmazonPage: process.env.ALEXA_AMAZON_DOMAIN ?? process.env.ALEXA_AMAZON_PAGE ?? "amazon.com",
    acceptLanguage: process.env.ALEXA_ACCEPT_LANGUAGE ?? "en-US",
    logger: debugAlexa && logger ? (msg: unknown) => logger.debug({ msg: sanitize(msg) }, "Alexa cookie debug") : undefined
  };

  return await new Promise((resolve) => {
    try {
      AlexaCookie.refreshAlexaCookie(options, (err: any, refreshed: AlexaCookieData) => {
        if (err || !refreshed) {
          logger?.warn({ err }, "Alexa cookie refresh failed; using existing registration data");
          return resolve(null);
        }
        logger?.info("Refreshed Alexa cookie using stored registration data");
        const refreshedValue =
          typeof refreshed === "object" && refreshed !== null
            ? refreshed
            : { cookie: String(refreshed) };
        resolve({ ...refreshedValue, refreshedAt: new Date().toISOString() });
      });
    } catch (err) {
      logger?.warn({ err }, "Alexa cookie refresh attempt threw; falling back to existing data");
      resolve(null);
    }
  });
}
