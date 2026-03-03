export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  const first = forwarded.split(",")[0]?.trim();
  if (first) return first;
  return request.headers.get("x-real-ip") || "unknown";
}

export function isSameOriginRequest(request: Request): boolean {
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin) return origin === requestOrigin;

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin === requestOrigin;
    } catch {
      return false;
    }
  }

  return false;
}
