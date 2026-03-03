import { SettingsForm } from "@/components/settings-form";
import { requireUser } from "@/lib/auth/server";
import { getOracleUserSettings } from "@/lib/db/oracle";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const settings = await getOracleUserSettings(user.id);

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground mt-1">
            Configure your AI provider, API key, and account preferences.
          </p>
        </div>
        <SettingsForm
          settings={settings}
          userEmail={user.email || ""}
        />
      </div>
    </div>
  );
}
