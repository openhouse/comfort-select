import pino from "pino";

const redactionPaths = [
  "*.headers.cookie",
  "*.headers.authorization",
  "*.cookie",
  "*.access_token",
  "*.refresh_token",
  "*.session-token",
  "*.sessionToken",
  "*.csrf",
  "*.frc",
  "*.device_private_key"
];

const pretty =
  process.env.NODE_ENV !== "production"
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname"
        }
      }
    : undefined;

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? "info",
    redact: { paths: redactionPaths, censor: "[REDACTED]" }
  },
  pretty ? (pino.transport(pretty) as any) : undefined
);
