import { UnauthorizedException } from "@nestjs/common";

export const sessionCookieName = "shanyu_session";

export function isSessionCookieSecure(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const configured = environment.SESSION_COOKIE_SECURE;
  if (!configured) {
    return environment.NODE_ENV === "production";
  }
  if (configured === "true") {
    return true;
  }
  if (configured === "false") {
    return false;
  }
  throw new Error("SESSION_COOKIE_SECURE 必须是 true 或 false");
}

export function readSessionToken(cookieHeader?: string): string {
  const sessionCookie = cookieHeader
    ?.split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${sessionCookieName}=`));
  const token = sessionCookie?.slice(sessionCookieName.length + 1);
  if (!token) {
    throw new UnauthorizedException("请先登录");
  }

  return token;
}
