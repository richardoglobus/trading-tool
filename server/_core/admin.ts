import type { User } from "../../drizzle/schema";
import { ENV } from "./env";

export function isAllowlistedAdminEmail(email: unknown): boolean {
  const configuredEmail = ENV.adminEmail.trim().toLowerCase();
  return (
    configuredEmail.length > 0 &&
    typeof email === "string" &&
    email.trim().toLowerCase() === configuredEmail
  );
}

export function isAdminAccount(
  user: Pick<User, "email" | "role"> | null | undefined,
): boolean {
  return Boolean(
    user && user.role === "admin" && isAllowlistedAdminEmail(user.email),
  );
}
