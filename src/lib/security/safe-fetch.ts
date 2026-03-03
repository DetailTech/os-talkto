import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

const PRIVATE_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map((p) => Number(p));
  return ((parts[0] << 24) >>> 0) + ((parts[1] << 16) >>> 0) + ((parts[2] << 8) >>> 0) + parts[3];
}

function isPrivateIPv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  const inRange = (start: string, end: string) => {
    const s = ipv4ToInt(start);
    const e = ipv4ToInt(end);
    return value >= s && value <= e;
  };

  return (
    inRange("10.0.0.0", "10.255.255.255") ||
    inRange("127.0.0.0", "127.255.255.255") ||
    inRange("169.254.0.0", "169.254.255.255") ||
    inRange("172.16.0.0", "172.31.255.255") ||
    inRange("192.168.0.0", "192.168.255.255") ||
    inRange("100.64.0.0", "100.127.255.255")
  );
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.") ||
    normalized.startsWith("::ffff:172.")
  );
}

async function assertSafeUrl(urlString: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error("Invalid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http/https URLs are allowed");
  }

  const hostname = url.hostname.toLowerCase();
  if (PRIVATE_HOSTNAMES.has(hostname) || hostname.endsWith(".internal")) {
    throw new Error("Blocked private hostname");
  }

  const ipType = isIP(hostname);
  if (ipType === 4 && isPrivateIPv4(hostname)) {
    throw new Error("Blocked private IPv4 address");
  }
  if (ipType === 6 && isPrivateIPv6(hostname)) {
    throw new Error("Blocked private IPv6 address");
  }

  if (ipType === 0) {
    const results = await lookup(hostname, { all: true });
    for (const record of results) {
      if (record.family === 4 && isPrivateIPv4(record.address)) {
        throw new Error("Blocked DNS resolution to private IPv4 address");
      }
      if (record.family === 6 && isPrivateIPv6(record.address)) {
        throw new Error("Blocked DNS resolution to private IPv6 address");
      }
    }
  }
}

export async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  await assertSafeUrl(url);
  const timeoutMs = Number(process.env.OUTBOUND_FETCH_TIMEOUT_MS || "15000");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: init?.signal || controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
