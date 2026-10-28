import { AXIOS_TIMEOUT_MS, COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
import axios, { type AxiosInstance } from "axios";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { isAllowlistedAdminEmail } from "./admin";
import { ENV } from "./env";

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

type SupabaseUser = {
  id: string;
  email?: string;
  user_metadata?: { full_name?: string; name?: string };
};

type SupabaseAuthResponse = {
  access_token?: string;
  user?: SupabaseUser;
  msg?: string;
  error_description?: string;
  error?: string;
};

export type SessionPayload = {
  openId: string;
  appId: string;
  name: string;
};

class SDKServer {
  private readonly client: AxiosInstance;
  private readonly supabaseClient: AxiosInstance;

  constructor(client: AxiosInstance = axios.create({ timeout: AXIOS_TIMEOUT_MS })) {
    this.client = client;
    this.supabaseClient = axios.create({
      baseURL: ENV.supabaseUrl,
      timeout: AXIOS_TIMEOUT_MS,
      headers: {
        apikey: ENV.supabasePublishableKey,
        "Content-Type": "application/json",
      },
    });
  }

  private getSessionSecret() {
    const secret = ENV.cookieSecret;
    if (!secret) throw new Error("MANUS_JWT_SECRET is unavailable");
    return new TextEncoder().encode(secret);
  }

  private normalizeSupabaseUser(user: SupabaseUser) {
    const name = user.user_metadata?.full_name || user.user_metadata?.name || user.email || "";
    return { openId: user.id, name, email: user.email ?? null };
  }

  async signInWithPassword(email: string, password: string) {
    const { data } = await this.supabaseClient.post<SupabaseAuthResponse>(
      "/auth/v1/token?grant_type=password",
      { email, password },
    );
    if (!data.access_token || !data.user) {
      throw new Error(data.error_description || data.msg || data.error || "Invalid email or password");
    }
    return { ...this.normalizeSupabaseUser(data.user), accessToken: data.access_token };
  }

  async signUpWithPassword(email: string, password: string) {
    const { data } = await this.supabaseClient.post<SupabaseAuthResponse>(
      "/auth/v1/signup",
      { email, password },
    );
    if (!data.user) {
      throw new Error(data.error_description || data.msg || data.error || "Could not create account");
    }
    return {
      ...this.normalizeSupabaseUser(data.user),
      accessToken: data.access_token ?? null,
      confirmationRequired: !data.access_token,
    };
  }

  async createSessionToken(openId: string, options: { expiresInMs?: number; name?: string } = {}) {
    return this.signSession(
      { openId, appId: ENV.appId || "tickwise", name: options.name || "" },
      options,
    );
  }

  async signSession(payload: SessionPayload, options: { expiresInMs?: number } = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
    return new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime(expirationSeconds)
      .sign(this.getSessionSecret());
  }

  async verifySession(cookieValue: string | undefined | null) {
    if (!cookieValue) return null;
    try {
      const { payload } = await jwtVerify(cookieValue, this.getSessionSecret(), { algorithms: ["HS256"] });
      const { openId, appId, name } = payload as Record<string, unknown>;
      if (!isNonEmptyString(openId) || typeof name !== "string") return null;
      if (appId !== (ENV.appId || "tickwise")) return null;
      return { openId, appId: String(appId), name };
    } catch {
      return null;
    }
  }

  async authenticateRequest(req: Request): Promise<AuthenticatedUser> {
    const cookies = parseCookieHeader(req.headers.cookie ?? "");
    let sessionToken = cookies[COOKIE_NAME];
    if (!sessionToken) {
      const authHeader = req.headers.authorization;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        sessionToken = authHeader.slice("Bearer ".length);
      }
    }

    const session = await this.verifySession(sessionToken);
    if (!session) throw ForbiddenError("Invalid session cookie");

    let user = await db.getUserByOpenId(session.openId);
    if (!user) throw ForbiddenError("User not found");
    if (!isAllowlistedAdminEmail(user.email)) throw ForbiddenError("Account is not authorized");

    await db.upsertUser({ openId: user.openId, lastSignedIn: new Date() });
    return user;
  }

  async ensureAdminUser(identity: { openId: string; name: string; email: string | null }) {
    if (!isAllowlistedAdminEmail(identity.email)) throw ForbiddenError("Account is not authorized");
    await db.upsertUser({
      openId: identity.openId,
      name: identity.name || null,
      email: identity.email,
      loginMethod: "email",
      role: "admin",
      lastSignedIn: new Date(),
    });
    const user = await db.getUserByOpenId(identity.openId);
    if (!user) throw new Error("User record was not created");
    return user;
  }
}

export type AuthenticatedUser = User;

export const sdk = new SDKServer();
