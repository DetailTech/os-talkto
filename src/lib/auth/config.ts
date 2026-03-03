import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { AuthConfig } from "./types";

const CONFIG_DIR = path.join(process.cwd(), ".data");
const CONFIG_PATH = path.join(CONFIG_DIR, "auth-config.json");

const DEFAULT_CONFIG: AuthConfig = {
  mode: "local",
  oci_iam: {
    issuer_url: "",
    client_id: "",
    redirect_uri: "",
  },
};

export async function getAuthConfig(): Promise<AuthConfig> {
  if (!existsSync(CONFIG_PATH)) {
    return DEFAULT_CONFIG;
  }

  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<AuthConfig>;
    return {
      mode: parsed.mode === "oci_iam" ? "oci_iam" : "local",
      oci_iam: {
        issuer_url: parsed.oci_iam?.issuer_url || "",
        client_id: parsed.oci_iam?.client_id || "",
        redirect_uri: parsed.oci_iam?.redirect_uri || "",
      },
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveAuthConfig(next: AuthConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(next, null, 2));
}
