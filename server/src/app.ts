import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import { pinoHttp } from "pino-http";
import { nanoid } from "nanoid";
import { logger } from "./lib/logger.js";
import { AppError } from "./lib/errors.js";
import healthRoutes from "./routes/health.js";
import authRoutes from "./routes/auth.js";
import projectRoutes from "./routes/projects.js";
import trackRoutes from "./routes/tracks.js";
import sampleRoutes from "./routes/samples.js";
import sessionRoutes from "./routes/sessions.js";
import userRoutes from "./routes/users.js";
import analyticsRoutes from "./routes/analytics.js";
import adminRoutes from "./routes/admin.js";

export function createApp() {
  const app = express();

  app.use((req, _res, next) => {
    const existing = req.header("x-request-id");
    (req as Request & { id: string }).id = existing ?? nanoid(12);
    next();
  });

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as Request & { id: string }).id,
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
    }),
  );

  app.use(
    cors({
      origin: (origin, cb) => {
        const allowed = (
          process.env.CORS_ORIGINS ??
          [
            "http://localhost:5173",
            "http://localhost:5000",
            "https://beats-prod-ant.web.app",
            "https://beats-prod-ant.firebaseapp.com",
          ].join(",")
        ).split(",");
        if (!origin || allowed.includes(origin)) return cb(null, true);
        cb(new Error("CORS blocked"));
      },
      credentials: true,
    }),
  );

  app.use(express.json({ limit: "1mb" }));

  app.use("/api", healthRoutes);
  app.use("/api", authRoutes);
  app.use("/api", projectRoutes);
  app.use("/api", trackRoutes);
  app.use("/api", sampleRoutes);
  app.use("/api", sessionRoutes);
  app.use("/api", userRoutes);
  app.use("/api", analyticsRoutes);
  app.use("/api", adminRoutes);

  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: `no route for ${req.method} ${req.path}`,
        requestId: (req as Request & { id: string }).id,
      },
    });
  });

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const requestId = (req as Request & { id: string }).id;
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ error: err.toApiError(requestId) });
      return;
    }
    logger.error({ err, requestId }, "unhandled error");
    res.status(500).json({
      error: { code: "INTERNAL", message: "internal server error", requestId },
    });
  });

  return app;
}
