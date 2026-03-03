import { upsertOracleUserSettings } from "./oracle";

export async function ensureDefaultUserSettings(userId: string): Promise<void> {
  await upsertOracleUserSettings(userId);
}
