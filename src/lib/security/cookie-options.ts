export function isSecureCookie(): boolean {
  const raw = (process.env.COOKIE_SECURE || "").trim().toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return process.env.NODE_ENV === "production";
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isSecureCookie(),
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export function clearCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isSecureCookie(),
    path: "/",
    maxAge: 0,
  };
}
