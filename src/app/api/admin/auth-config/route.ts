import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { getAuthConfig, saveAuthConfig } from "@/lib/auth/config";
import type { AuthConfig } from "@/lib/auth/types";

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return null;
  return user;
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const config = await getAuthConfig();
  return NextResponse.json({ config });
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json()) as Partial<AuthConfig>;
  const next: AuthConfig = {
    mode: body.mode === "oci_iam" ? "oci_iam" : "local",
    oci_iam: {
      issuer_url: body.oci_iam?.issuer_url || "",
      client_id: body.oci_iam?.client_id || "",
      redirect_uri: body.oci_iam?.redirect_uri || "",
    },
  };

  if (
    next.mode === "oci_iam" &&
    (!next.oci_iam.issuer_url || !next.oci_iam.client_id || !next.oci_iam.redirect_uri)
  ) {
    return NextResponse.json(
      { error: "issuer_url, client_id, and redirect_uri are required for OCI IAM mode" },
      { status: 400 }
    );
  }

  await saveAuthConfig(next);
  return NextResponse.json({ success: true, config: next });
}
