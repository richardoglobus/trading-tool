import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { isAdminAccount } from "./admin";
import { sdk } from "./sdk";
import { getSessionCookieOptions } from "./cookies";
import { isAllowlistedAdminEmail } from "./admin";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { serveStatic, setupVite } from "./vite";
import { ENV } from "./env";

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
  app.post("/api/auth/login", async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required." });
      return;
    }
    if (!isAllowlistedAdminEmail(email)) {
      res.status(403).json({ error: "This email is not authorized for Tickwise." });
      return;
    }
    try {
      const identity = await sdk.signInWithPassword(email, password);
      const user = await sdk.ensureAdminUser(identity);
      const sessionToken = await sdk.createSessionToken(user.openId, { name: user.name || email });
      res.cookie(COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS });
      res.json({ success: true });
    } catch (error) {
      console.error("[Auth] Password login failed", error instanceof Error ? error.message : "unknown error");
      res.status(401).json({ error: "Invalid email or password." });
    }
  });
  app.post("/api/auth/signup", async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!email || password.length < 8) {
      res.status(400).json({ error: "Use the authorized email and a password of at least 8 characters." });
      return;
    }
    if (!isAllowlistedAdminEmail(email)) {
      res.status(403).json({ error: "Only the configured admin email can create this account." });
      return;
    }
    try {
      const identity = await sdk.signUpWithPassword(email, password);
      if (identity.confirmationRequired || !identity.accessToken) {
        res.json({ success: true, confirmationRequired: true });
        return;
      }
      const user = await sdk.ensureAdminUser(identity);
      const sessionToken = await sdk.createSessionToken(user.openId, { name: user.name || email });
      res.cookie(COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS });
      res.json({ success: true, confirmationRequired: false });
    } catch (error) {
      console.error("[Auth] Password signup failed", error instanceof Error ? error.message : "unknown error");
      res.status(400).json({ error: "Could not create the account. It may already exist." });
    }
  });
  app.post("/api/auth/forgot-password", async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!email || !isAllowlistedAdminEmail(email)) {
      res.status(400).json({ error: "Enter the configured administrator email." });
      return;
    }
    try {
      await sdk.requestPasswordReset(email, `${ENV.publicUrl}/reset-password`);
      res.json({ success: true });
    } catch (error) {
      console.error("[Auth] Password reset request failed", error instanceof Error ? error.message : "unknown error");
      res.status(400).json({ error: "Could not send the reset email. Please try again." });
    }
  });
  app.post("/api/auth/reset-password", async (req, res) => {
    const accessToken = typeof req.body?.accessToken === "string" ? req.body.accessToken : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!accessToken || password.length < 8) {
      res.status(400).json({ error: "Use a valid reset link and a password of at least 8 characters." });
      return;
    }
    try {
      await sdk.updatePassword(accessToken, password);
      res.json({ success: true });
    } catch (error) {
      console.error("[Auth] Password reset failed", error instanceof Error ? error.message : "unknown error");
      res.status(400).json({ error: "This reset link is invalid or expired. Request a new one." });
    }
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
