import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "../_load-env.js";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AlexaCookie: any = require("alexa-cookie2");

const cookieRel = process.env.ALEXA_COOKIE_PATH ?? process.env.ALEXA_COOKIE_JSON ?? "config/secrets/alexa-cookie.json";
const cookiePath = path.isAbsolute(cookieRel) ? cookieRel : path.join(projectRoot, cookieRel);
const amazonPage = process.env.ALEXA_AMAZON_PAGE ?? process.env.ALEXA_AMAZON_DOMAIN ?? "amazon.com";
const acceptLanguage = process.env.ALEXA_ACCEPT_LANGUAGE ?? "en-US";
const baseAmazonPage = process.env.ALEXA_AMAZON_DOMAIN ?? process.env.ALEXA_AMAZON_PAGE ?? amazonPage;

async function loadExistingRegistration() {
  const raw = await fs.readFile(cookiePath, "utf-8");
  return JSON.parse(raw);
}

async function writeCookieFile(data: any) {
  await fs.mkdir(path.dirname(cookiePath), { recursive: true });
  const payload = { ...data, updatedAt: new Date().toISOString() };
  await fs.writeFile(cookiePath, JSON.stringify(payload, null, 2), { encoding: "utf-8", mode: 0o600 });
  console.log(`[alexa-cookie] Wrote refreshed Alexa cookie JSON to ${cookiePath}`);
}

async function refreshCookie() {
  let formerRegistrationData: any;
  try {
    formerRegistrationData = await loadExistingRegistration();
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      console.error(`[alexa-cookie] No cookie JSON found at ${cookiePath}. Run 'npm run alexa:cookie:init' first.`);
      process.exit(1);
    }
    throw err;
  }

  const options = {
    formerRegistrationData,
    amazonPage,
    baseAmazonPage,
    acceptLanguage,
    proxyOnly: true,
    logger: (msg: unknown) => console.log(String(msg))
  };

  const refreshed: any = await new Promise((resolve, reject) => {
    AlexaCookie.refreshAlexaCookie(options, (err: any, result: any) => {
      if (err) return reject(err);
      if (!result) return reject(new Error("No data returned from refreshAlexaCookie"));
      resolve(result);
    });
  });

  await writeCookieFile(refreshed);
}

refreshCookie().catch((err) => 
  // eslint-disable-next-line no-console
  console.error("[alexa-cookie] Failed to refresh cookie:", err) || process.exit(1)
);
