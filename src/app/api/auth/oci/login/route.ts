import { NextRequest, NextResponse } from "next/server";
import { getAuthConfig } from "@/lib/auth/config";
import {
  createCodeChallenge,
  createCodeVerifier,
  createNonce,
  createState,
  fetchOidcDiscovery,
} from "@/lib/auth/oidc";
import { isSecureCookie } from "@/lib/security/cookie-options";

const OIDC_STATE_COOKIE = "talkto_oidc_state";
const OIDC_VERIFIER_COOKIE = "talkto_oidc_verifier";
const OIDC_NONCE_COOKIE = "talkto_oidc_nonce";

export async function GET(request: NextRequest) {
  const config = await getAuthConfig();
  const origin = request.nextUrl.origin;

  if (config.mode !== "oci_iam") {
    return NextResponse.redirect(new URL("/login?error=oci_mode_disabled", origin));
  }

  if (!config.oci_iam.issuer_url || !config.oci_iam.client_id || !config.oci_iam.redirect_uri) {
    return NextResponse.redirect(new URL("/login?error=oci_config_missing", origin));
  }

  const discovery = await fetchOidcDiscovery(config.oci_iam.issuer_url);

  const state = createState();
  const nonce = createNonce();
  const codeVerifier = createCodeVerifier();
  const codeChallenge = createCodeChallenge(codeVerifier);

  const authUrl = new URL(discovery.authorization_endpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", config.oci_iam.client_id);
  authUrl.searchParams.set("redirect_uri", config.oci_iam.redirect_uri);
  authUrl.searchParams.set("scope", "openid profile email");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("nonce", nonce);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  const response = NextResponse.redirect(authUrl);
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isSecureCookie(),
    path: "/",
    maxAge: 60 * 10,
  };

  response.cookies.set(OIDC_STATE_COOKIE, state, cookieOptions);
  response.cookies.set(OIDC_VERIFIER_COOKIE, codeVerifier, cookieOptions);
  response.cookies.set(OIDC_NONCE_COOKIE, nonce, cookieOptions);

  return response;
}
