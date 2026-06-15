import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../env";

const TOKEN_TTL_SECONDS = 12 * 60 * 60;
const ADMIN_SUBJECT = "pulserx-admin";

type AdminTokenPayload = {
  sub: typeof ADMIN_SUBJECT;
  iat: number;
  exp: number;
};

export class AdminAuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 401,
  ) {
    super(message);
  }
}

function getSecret() {
  if (env.ADMIN_SESSION_SECRET) {
    return env.ADMIN_SESSION_SECRET;
  }

  return env.ADMIN_PASSWORD;
}

function assertAdminConfigured() {
  if (!env.ADMIN_PASSWORD || !getSecret()) {
    throw new AdminAuthError(
      "Admin login is not configured. Set ADMIN_PASSWORD and ADMIN_SESSION_SECRET on the API deployment.",
      503,
    );
  }
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(payload: string) {
  const secret = getSecret();
  if (!secret) {
    throw new AdminAuthError("Admin login is not configured.", 503);
  }

  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function secureEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function createAdminSessionToken() {
  assertAdminConfigured();

  const now = Math.floor(Date.now() / 1000);
  const payload: AdminTokenPayload = {
    sub: ADMIN_SUBJECT,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload);

  return {
    token: `${encodedPayload}.${signature}`,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

export function verifyAdminPassword(password: string) {
  assertAdminConfigured();

  return secureEquals(password, env.ADMIN_PASSWORD ?? "");
}

export function verifyAdminToken(token: string) {
  assertAdminConfigured();

  const [encodedPayload, signature] = token.split(".");
  if (
    !encodedPayload ||
    !signature ||
    !secureEquals(signature, sign(encodedPayload))
  ) {
    throw new AdminAuthError("Admin session is invalid or expired.");
  }

  let payload: AdminTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload)) as AdminTokenPayload;
  } catch {
    throw new AdminAuthError("Admin session is invalid or expired.");
  }

  if (
    payload.sub !== ADMIN_SUBJECT ||
    payload.exp < Math.floor(Date.now() / 1000)
  ) {
    throw new AdminAuthError("Admin session is invalid or expired.");
  }

  return payload;
}

export function pathRequiresAdmin(pathname: string) {
  if (pathname === "/admin/auth/login") {
    return false;
  }

  return (
    pathname.startsWith("/admin/") ||
    pathname === "/admin" ||
    pathname.startsWith("/studies") ||
    pathname.startsWith("/integrations/") ||
    pathname.startsWith("/mvp/customgpt-survey/audit/") ||
    /^\/sessions\/[^/]+\/audit$/.test(pathname)
  );
}

export async function requireAdminSession(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!pathRequiresAdmin(request.url.split("?")[0] ?? request.url)) {
    return;
  }

  const authHeader = request.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  try {
    verifyAdminToken(token);
  } catch (error) {
    const statusCode = error instanceof AdminAuthError ? error.statusCode : 401;
    return reply.status(statusCode).send({
      message:
        error instanceof Error
          ? error.message
          : "Admin session is invalid or expired.",
    });
  }
}
