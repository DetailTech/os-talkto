import { createHash, randomBytes, createPublicKey, verify as verifySignature } from "node:crypto";
import type { AuthConfig } from "./types";

interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

interface JsonWebKeySet {
  keys: OidcJwk[];
}

interface OidcJwk {
  kty: string;
  kid?: string;
  use?: string;
  n?: string;
  e?: string;
  [key: string]: unknown;
}

type JwtHeader = {
  alg: string;
  kid?: string;
  typ?: string;
};

export type OidcIdTokenClaims = {
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;
  nonce?: string;
  email?: string;
  sub: string;
};

function base64UrlEncode(buffer: Buffer | string): string {
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer, "utf8");
  return input.toString("base64url");
}

function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export function createCodeVerifier(): string {
  return base64UrlEncode(randomBytes(48));
}

export function createCodeChallenge(verifier: string): string {
  return base64UrlEncode(createHash("sha256").update(verifier).digest());
}

export function createState(): string {
  return base64UrlEncode(randomBytes(24));
}

export function createNonce(): string {
  return base64UrlEncode(randomBytes(24));
}

export async function fetchOidcDiscovery(issuerUrl: string): Promise<OidcDiscovery> {
  const baseIssuer = issuerUrl.replace(/\/$/, "");
  const wellKnownUrl = `${baseIssuer}/.well-known/openid-configuration`;
  const response = await fetch(wellKnownUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to fetch OIDC discovery document");
  }
  const discovery = (await response.json()) as OidcDiscovery;
  if (!discovery.authorization_endpoint || !discovery.token_endpoint || !discovery.jwks_uri) {
    throw new Error("Invalid OIDC discovery document");
  }
  return discovery;
}

export async function exchangeAuthorizationCode(params: {
  tokenEndpoint: string;
  clientId: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
  clientSecret?: string;
}): Promise<{ id_token: string; access_token?: string; token_type?: string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });

  if (params.clientSecret) {
    body.set("client_secret", params.clientSecret);
  }

  const response = await fetch(params.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`OIDC token exchange failed: ${details || response.statusText}`);
  }

  const tokenResponse = (await response.json()) as {
    id_token?: string;
    access_token?: string;
    token_type?: string;
  };

  if (!tokenResponse.id_token) {
    throw new Error("OIDC token response did not include id_token");
  }

  return tokenResponse as { id_token: string; access_token?: string; token_type?: string };
}

export async function validateIdToken(params: {
  idToken: string;
  config: AuthConfig;
  expectedNonce: string;
}): Promise<OidcIdTokenClaims> {
  const { idToken, config, expectedNonce } = params;
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid id_token format");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = JSON.parse(base64UrlDecode(encodedHeader).toString("utf8")) as JwtHeader;
  const payload = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8")) as OidcIdTokenClaims;
  const signature = base64UrlDecode(encodedSignature);

  if (header.alg !== "RS256") {
    throw new Error(`Unsupported JWT alg: ${header.alg}`);
  }

  const discovery = await fetchOidcDiscovery(config.oci_iam.issuer_url);
  const jwksResponse = await fetch(discovery.jwks_uri, { cache: "no-store" });
  if (!jwksResponse.ok) {
    throw new Error("Failed to fetch OIDC JWKS");
  }
  const jwks = (await jwksResponse.json()) as JsonWebKeySet;

  const jwk = jwks.keys.find((k) => k.kid === header.kid && k.kty === "RSA");
  if (!jwk) {
    throw new Error("No matching JWK found for id_token");
  }

  const publicKey = createPublicKey({ key: jwk as any, format: "jwk" });
  const signedContent = Buffer.from(`${encodedHeader}.${encodedPayload}`, "utf8");
  const validSignature = verifySignature("RSA-SHA256", signedContent, publicKey, signature);
  if (!validSignature) {
    throw new Error("Invalid id_token signature");
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    throw new Error("id_token is expired");
  }

  const expectedIssuer = config.oci_iam.issuer_url.replace(/\/$/, "");
  const actualIssuer = payload.iss.replace(/\/$/, "");
  if (actualIssuer !== expectedIssuer) {
    throw new Error("id_token issuer mismatch");
  }

  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audience.includes(config.oci_iam.client_id)) {
    throw new Error("id_token audience mismatch");
  }

  if (payload.nonce !== expectedNonce) {
    throw new Error("id_token nonce mismatch");
  }

  return payload;
}
