interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function nowMs(): number {
  return Date.now();
}

export function checkRateLimit(input: {
  key: string;
  windowMs: number;
  maxRequests: number;
}): { allowed: boolean; retryAfterSeconds: number } {
  const now = nowMs();
  const existing = buckets.get(input.key);

  if (!existing || now > existing.resetAt) {
    buckets.set(input.key, {
      count: 1,
      resetAt: now + input.windowMs,
    });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count <= input.maxRequests) {
    buckets.set(input.key, existing);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
  return { allowed: false, retryAfterSeconds };
}
