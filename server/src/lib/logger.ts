import pino from "pino";

// pino-pretty is a devDependency — skip it in any managed runtime
// (Firebase Functions / Cloud Run) so prod containers don't fail to boot
// when loading the transport. Setting NODE_ENV=development locally still
// gets the pretty output; the runtime detection is the safety net.
const isInManagedRuntime =
  !!process.env.FUNCTION_TARGET || !!process.env.K_SERVICE;
const usePrettyTransport =
  !isInManagedRuntime && process.env.NODE_ENV !== "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "beats-api" },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(usePrettyTransport && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "HH:MM:ss" },
    },
  }),
});
