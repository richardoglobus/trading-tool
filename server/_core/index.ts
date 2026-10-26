import "dotenv/config.js";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { isAdminAccount } from "./admin";
import { sdk } from "./sdk";
import { serveStatic, setupVite } from "./vite";

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "1mb", extended: true }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  app.use(async (req, res, next) => {
    const isDocumentRequest =
      (req.method === "GET" || req.method === "HEAD") &&
      !req.path.startsWith("/api") &&
      (!/\.[^/]+$/.test(req.path) || /\.html?$/i.test(req.path));

    if (!isDocumentRequest) {
      next();
      return;
    }

    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    if (req.path.replace(/\/+$/, "") === "/login") {
      next();
      return;
    }

    try {
      const user = await sdk.authenticateRequest(req);
      if (isAdminAccount(user)) {
        next();
        return;
      }
      res.redirect(302, "/login?error=not_authorized");
    } catch {
      res.redirect(302, "/login");
    }
  });
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  server.on("error", error => { console.error("Server failed:", error.message); process.exit(1); });
  const host = process.env.HOST || (process.env.NODE_ENV === "development" ? "127.0.0.1" : "0.0.0.0");
  server.listen(port, host, () => console.log(`Server listening on ${host}:${port}`));
}

startServer().catch(error => { console.error(error); process.exit(1); });
