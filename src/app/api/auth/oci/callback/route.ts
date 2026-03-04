import { NextRequest, NextResponse } from "next/server";
import { getAuthConfig } from "@/lib/auth/config";
import {
  exchangeAuthorizationCode,
  fetchOidcDiscovery,
  validateIdToken,
} from "@/lib/auth/oidc";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth/session";
import { upsertOidcUser } from "@/lib/auth/local-users";
import { ensureDefaultUserSettings } from "@/lib/db/user-settings";
import { isSecureCookie, sessionCookieOptions } from "@/lib/security/cookie-options";

const OIDC_STATE_COOKIE = "talkto_oidc_state";
const OIDC_VERIFIER_COOKIE = "talkto_oidc_verifier";
const OIDC_NONCE_COOKIE = "talkto_oidc_nonce";

function clearOidcCookies(response: NextResponse) {
  const base = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isSecureCookie(),
    path: "/",
    maxAge: 0,
  };
  response.cookies.set(OIDC_STATE_COOKIE, "", base);
  response.cookies.set(OIDC_VERIFIER_COOKIE, "", base);
  response.cookies.set(OIDC_NONCE_COOKIE, "", base);
}

export async function GET(request: NextRequest) {
  const config = await getAuthConfig();
  const origin = request.nextUrl.origin;

  const code = request.nextUrl.searchParams.get("code");
  const returnedState = request.nextUrl.searchParams.get("state");
  const oauthError = request.nextUrl.searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(`${origin}/login?error=oci_oauth_${encodeURIComponent(oauthError)}`);
  }

  if (config.mode !== "oci_iam") {
    return NextResponse.redirect(`${origin}/login?error=oci_mode_disabled`);
  }

  if (!code || !returnedState) {
    return NextResponse.redirect(`${origin}/login?error=oci_missing_code`);
  }

  const expectedState = request.cookies.get(OIDC_STATE_COOKIE)?.value || "";
  const codeVerifier = request.cookies.get(OIDC_VERIFIER_COOKIE)?.value || "";
  const expectedNonce = request.cookies.get(OIDC_NONCE_COOKIE)?.value || "";

  if (!expectedState || !codeVerifier || !expectedNonce || expectedState !== returnedState) {
    return NextResponse.redirect(`${origin}/login?error=oci_state_mismatch`);
  }

  try {
    const discovery = await fetchOidcDiscovery(config.oci_iam.issuer_url);
    const tokenResponse = await exchangeAuthorizationCode({
      tokenEndpoint: discovery.token_endpoint,
      clientId: config.oci_iam.client_id,
      redirectUri: config.oci_iam.redirect_uri,
      code,
      codeVerifier,
      clientSecret: process.env.AUTH_OCI_CLIENT_SECRET,
    });

    const claims = await validateIdToken({
      idToken: tokenResponse.id_token,
      config,
      expectedNonce,
    });

    if (!claims.email) {
      return NextResponse.redirect(`${origin}/login?error=oci_email_missing`);
    }

    const user = await upsertOidcUser(claims.email);
    try {
      await ensureDefaultUserSettings(user.id);
    } catch (error) {
      console.error("OCI user settings provisioning failed", error);
    }

    const token = createSessionToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    const response = NextResponse.redirect(`${origin}/`);
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(60 * 60 * 24 * 7));
    clearOidcCookies(response);
    return response;
  } catch (error) {
    const response = NextResponse.redirect(`${origin}/login?error=oci_callback_failed`);
    clearOidcCookies(response);
    console.error("OCI OIDC callback failed", error);
    return response;
  }
}
