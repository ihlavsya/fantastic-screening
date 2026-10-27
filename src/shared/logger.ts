import { pino } from "pino";

export type Logger = Record<LogLevel, (event: LogEvent, message: string) => void>;

export type LogEvent = { eventType: string } & Record<string, unknown>;

type LogLevel = "debug" | "info" | "warn" | "error";

const pinoLogger = pino({
  base: undefined,
  timestamp: buildTimestamp,
});

export const logger: Logger = {
  debug: (event, message) => {
    pinoLogger.debug(event, message);
  },
  info: (event, message) => {
    pinoLogger.info(event, message);
  },
  warn: (event, message) => {
    pinoLogger.warn(event, message);
  },
  error: (event, message) => {
    pinoLogger.error(event, message);
  },
};

function buildTimestamp(): string {
  const now = new Date();
  return `,"ts":${String(now.getTime())},"tsIso":"${now.toISOString()}"`;
}
