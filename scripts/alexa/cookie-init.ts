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
const proxyPort = Number(process.env.ALEXA_COOKIE_PROXY_PORT ?? 3456);
const proxyOwnIp = process.env.ALEXA_COOKIE_PROXY_OWN_IP ?? process.env.ALEXA_PROXY_OWN_IP ?? "localhost";
const proxyListenBind = process.env.ALEXA_COOKIE_PROXY_LISTEN_BIND ?? "127.0.0.1";
const baseAmazonPage = process.env.ALEXA_AMAZON_DOMAIN ?? process.env.ALEXA_AMAZON_PAGE ?? amazonPage;

async function readExistingRegistration() {
  try {
    const raw = await fs.readFile(cookiePath, "utf-8");
    const parsed = JSON.parse(raw);
    console.log(`[alexa-cookie] Found existing registration data at ${cookiePath}`);
    return parsed;
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      console.warn(`[alexa-cookie] Unable to read existing cookie file at ${cookiePath}: ${err.message ?? err}`);
    }
    return undefined;
  }
}

async function writeCookieFile(data: any) {
  await fs.mkdir(path.dirname(cookiePath), { recursive: true });
  const payload = { ...data, updatedAt: new Date().toISOString() };
  await fs.writeFile(cookiePath, JSON.stringify(payload, null, 2), { encoding: "utf-8", mode: 0o600 });
  console.log(`[alexa-cookie] Saved Alexa cookie JSON to ${cookiePath}`);
}

async function generateCookie() {
  const formerRegistrationData = await readExistingRegistration();

  const options = {
    setupProxy: true,
    proxyOnly: true,
    proxyPort,
    proxyOwnIp,
    proxyListenBind,
    acceptLanguage,
    amazonPage,
    baseAmazonPage,
    logger: (msg: unknown) => console.log(String(msg)),
    formerRegistrationData
  };

  console.log("[alexa-cookie] Starting proxy login flow...");
  console.log(`[alexa-cookie] Open http://${proxyOwnIp}:${proxyPort}/ in your browser to continue.`);
  console.log(`[alexa-cookie] Writing cookie JSON to ${cookiePath}`);

  const cookieData: any = await new Promise((resolve, reject) => {
    let sawInstruction = false;
    const callback = (err: any, result: any) => {
      if (result) return resolve(result);
      if (err && !result) {
        console.log(err?.message ?? String(err));
        if (sawInstruction) {
          return reject(err);
        }
        sawInstruction = true;
        return;
      }
      if (err) return reject(err);
      reject(new Error("alexa-cookie2 did not return a result"));
    };

    if (AlexaCookie.generateAlexaCookie.length >= 4) {
      AlexaCookie.generateAlexaCookie("", "", options, callback);
    } else {
      AlexaCookie.generateAlexaCookie(options, callback);
    }
  });

  await writeCookieFile(cookieData);

  if (typeof AlexaCookie.stopProxyServer === "function") {
    AlexaCookie.stopProxyServer(() => {
      console.log("[alexa-cookie] Proxy server stopped");
    });
  }
}

process.on("SIGINT", () => {
  if (typeof AlexaCookie.stopProxyServer === "function") {
    AlexaCookie.stopProxyServer(() => process.exit(130));
  } else {
    process.exit(130);
  }
});

process.on("SIGTERM", () => {
  if (typeof AlexaCookie.stopProxyServer === "function") {
    AlexaCookie.stopProxyServer(() => process.exit(143));
  } else {
    process.exit(143);
  }
});

generateCookie().catch((err) => {
  console.error("[alexa-cookie] Failed to generate cookie:", err);
  process.exit(1);
});
