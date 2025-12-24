import pino from "pino";

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
    level: process.env.LOG_LEVEL ?? "info"
  },
  pretty ? (pino.transport(pretty) as any) : undefined
);
