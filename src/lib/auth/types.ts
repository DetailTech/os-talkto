export type AppRole = "admin" | "user";

export interface LocalUser {
  id: string;
  email: string;
  password_hash: string;
  role: AppRole;
  created_at: string;
  updated_at: string;
}

export interface SessionPayload {
  sub: string;
  email: string;
  role: AppRole;
  exp: number;
}

export type AuthMode = "local" | "oci_iam";

export interface AuthConfig {
  mode: AuthMode;
  oci_iam: {
    issuer_url: string;
    client_id: string;
    redirect_uri: string;
  };
}
