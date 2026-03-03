"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Check,
  Key,
  Bot,
  Shield,
  ExternalLink,
  Trash2,
  LogOut,
} from "lucide-react";
import { AI_PROVIDERS, type AIProvider, type UserSettings } from "@/types/database";

interface SettingsFormProps {
  settings: UserSettings | null;
  userEmail: string;
}

export function SettingsForm({ settings, userEmail }: SettingsFormProps) {
  const router = useRouter();

  const [provider, setProvider] = useState<AIProvider>(settings?.ai_provider || "openai");
  const [model, setModel] = useState(settings?.ai_model || "gpt-4o");
  const [modelSearch, setModelSearch] = useState(settings?.ai_model || "gpt-4o");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<{ id: string; name: string }[]>(
    AI_PROVIDERS.find((p) => p.id === (settings?.ai_provider || "openai"))?.models || []
  );

  const [newPassword, setNewPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  const selectedProvider = AI_PROVIDERS.find((p) => p.id === provider);

  async function loadModels(providerToLoad: AIProvider, keyCandidate?: string) {
    setLoadingModels(true);
    try {
      const response = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: providerToLoad,
          apiKey: keyCandidate?.trim() ? keyCandidate.trim() : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to load models");
      }
      setError("");
      const nextModels = (data.models as { id: string; name: string }[]) || [];
      if (nextModels.length > 0) {
        setAvailableModels(nextModels);
        if (!nextModels.some((m) => m.id === model)) {
          setModel(nextModels[0].id);
          setModelSearch(nextModels[0].id);
        }
      }
    } catch (err) {
      const fallbackModels = AI_PROVIDERS.find((p) => p.id === providerToLoad)?.models || [];
      setAvailableModels(fallbackModels);
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(`Could not load live models for ${providerToLoad}: ${message}`);
    } finally {
      setLoadingModels(false);
    }
  }

  useEffect(() => {
    void loadModels(provider);
    // intentionally once per provider change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  function handleProviderChange(newProvider: AIProvider) {
    setProvider(newProvider);
    const providerConfig = AI_PROVIDERS.find((p) => p.id === newProvider);
    if (providerConfig && providerConfig.models.length > 0) {
      setModel(providerConfig.models[0].id);
      setModelSearch(providerConfig.models[0].id);
      setAvailableModels(providerConfig.models);
    }
  }

  async function handleSaveAI(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);

    try {
      const body: Record<string, string> = {
        provider,
        model,
      };
      if (apiKey.trim()) {
        body.apiKey = apiKey.trim();
      }

      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to save");
      }

      setSaved(true);
      setApiKey("");
      setTimeout(() => setSaved(false), 3000);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordSaving(true);
    setPasswordError("");
    setPasswordSuccess(false);

    if (newPassword.length < 8) {
      setPasswordError("Password must be at least 8 characters");
      setPasswordSaving(false);
      return;
    }

    const response = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: newPassword }),
    });
    const data = await response.json();
    if (!response.ok) {
      setPasswordError(data.error || "Failed to update password");
    } else {
      setPasswordSuccess(true);
      setNewPassword("");
      setTimeout(() => setPasswordSuccess(false), 3000);
    }

    setPasswordSaving(false);
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  async function handleDeleteAccount() {
    if (
      !window.confirm(
        "Are you sure you want to delete your account? This action cannot be undone."
      )
    ) {
      return;
    }
    await fetch("/api/auth/account", { method: "DELETE" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* AI Provider Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            <CardTitle>AI Provider</CardTitle>
          </div>
          <CardDescription>
            Choose your AI provider and enter your API key. Your key is encrypted and stored securely.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveAI} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="provider">Provider</Label>
              <Select
                id="provider"
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value as AIProvider)}
              >
                {AI_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              <Input
                id="model"
                list="provider-models"
                value={modelSearch || model}
                onChange={(e) => {
                  const next = e.target.value;
                  setModelSearch(next);
                  setModel(next);
                }}
                placeholder={loadingModels ? "Loading models..." : "Search/select model"}
              />
              <datalist id="provider-models">
                {availableModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </datalist>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => loadModels(provider, apiKey)}
                  disabled={loadingModels}
                >
                  {loadingModels && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Refresh Models
                </Button>
                <p className="text-xs text-muted-foreground">
                  {availableModels.length} models loaded for {selectedProvider?.name}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="apiKey">
                API Key
                {settings?.encrypted_api_key && (
                  <Badge variant="secondary" className="ml-2 text-xs">
                    Key saved
                  </Badge>
                )}
              </Label>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="apiKey"
                  type="password"
                  placeholder={
                    settings?.encrypted_api_key
                      ? "Enter new key to update..."
                      : "Enter your API key..."
                  }
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                  }}
                  className="pl-10"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Your API key is encrypted before being stored. It&apos;s only used for your chat sessions.
              </p>
              <p className="text-xs text-muted-foreground">
                Note: All AI operations use your selected provider key (OpenAI, Google, or OpenRouter).
              </p>
            </div>

            {error && <p className="text-sm text-destructive-foreground">{error}</p>}

            <Button type="submit" disabled={saving}>
              {saving ? (
                <Loader2 className="animate-spin mr-2 h-4 w-4" />
              ) : saved ? (
                <Check className="mr-2 h-4 w-4" />
              ) : null}
              {saved ? "Saved!" : "Save Settings"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Account Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            <CardTitle>Account</CardTitle>
          </div>
          <CardDescription>
            Manage your account settings and security.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-muted-foreground">Email</Label>
            <p className="text-sm font-medium mt-1">{userEmail}</p>
          </div>

          <Separator />

          <form onSubmit={handleChangePassword} className="space-y-3">
            <Label>Change Password</Label>
            <Input
              type="password"
              placeholder="New password (min 8 characters)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={8}
            />
            {passwordError && (
              <p className="text-sm text-destructive-foreground">{passwordError}</p>
            )}
            {passwordSuccess && (
              <p className="text-sm text-green-600">Password updated successfully!</p>
            )}
            <Button type="submit" variant="outline" size="sm" disabled={passwordSaving || !newPassword}>
              {passwordSaving && <Loader2 className="animate-spin mr-2 h-4 w-4" />}
              Update Password
            </Button>
          </form>

          <Separator />

          {/* Contact & Support */}
          <div>
            <Label className="text-muted-foreground">Support</Label>
            <p className="text-sm mt-1">
              <a
                href="mailto:support@talkto.app"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                Contact Support
                <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          </div>

          <Separator />

          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </Button>
            <Button variant="destructive" onClick={handleDeleteAccount}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Account
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
