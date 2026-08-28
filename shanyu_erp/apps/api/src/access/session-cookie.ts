import { UnauthorizedException } from "@nestjs/common";

export const sessionCookieName = "shanyu_session";

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
