import pino from "pino";
import type { LoggingConfig } from "../config/types.js";

export type Logger = pino.Logger;

export function createLogger(config?: LoggingConfig): Logger {
  const level = config?.level ?? "info";
  const isJson = config?.json ?? process.env["NODE_ENV"] === "production";

  const transport = isJson
    ? undefined
    : {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss" },
      };

  const options: pino.LoggerOptions = {
    level,
    ...(transport ? { transport } : {}),
  };

  if (config?.file) {
    return pino(options, pino.destination(config.file));
  }

  return pino(options);
}
