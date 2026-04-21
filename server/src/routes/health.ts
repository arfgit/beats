import { Router } from "express";

const router = Router();

router.get("/health", (_req, res) => {
  res.json({ data: { status: "ok", service: "beats-api", time: Date.now() } });
});

export default router;
