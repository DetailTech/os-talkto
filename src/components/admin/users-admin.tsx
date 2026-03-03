"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AppRole, AuthConfig } from "@/lib/auth/types";

interface AdminUser {
  id: string;
  email: string;
  role: AppRole;
  created_at: string;
}

export function UsersAdmin() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AppRole>("user");
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [message, setMessage] = useState("");

  async function load() {
    const [usersRes, configRes] = await Promise.all([
      fetch("/api/admin/users", { cache: "no-store" }),
      fetch("/api/admin/auth-config", { cache: "no-store" }),
    ]);

    const usersData = await usersRes.json();
    if (usersRes.ok) setUsers(usersData.users || []);

    const configData = await configRes.json();
    if (configRes.ok) setAuthConfig(configData.config || null);
  }

  useEffect(() => {
    void load();
  }, []);

  async function createNewUser(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, role }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "Failed to create user");
      return;
    }

    setEmail("");
    setPassword("");
    setRole("user");
    setMessage("User created");
    await load();
  }

  async function toggleRole(user: AdminUser) {
    const nextRole: AppRole = user.role === "admin" ? "user" : "admin";
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: user.id, role: nextRole }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "Failed to update role");
      return;
    }
    await load();
  }

  async function removeUser(user: AdminUser) {
    const res = await fetch(`/api/admin/users?id=${encodeURIComponent(user.id)}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "Failed to delete user");
      return;
    }
    await load();
  }

  async function saveAuthMode(e: React.FormEvent) {
    e.preventDefault();
    if (!authConfig) return;

    const res = await fetch("/api/admin/auth-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(authConfig),
    });

    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "Failed to save auth config");
      return;
    }

    setMessage("Auth configuration saved");
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Authentication Mode</CardTitle>
          <CardDescription>Switch between local auth and OCI IAM config.</CardDescription>
        </CardHeader>
        <CardContent>
          {authConfig && (
            <form className="space-y-3" onSubmit={saveAuthMode}>
              <div className="space-y-2">
                <Label>Mode</Label>
                <Select
                  value={authConfig.mode}
                  onChange={(e) =>
                    setAuthConfig({ ...authConfig, mode: e.target.value === "oci_iam" ? "oci_iam" : "local" })
                  }
                >
                  <option value="local">Local</option>
                  <option value="oci_iam">OCI IAM</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>OCI Issuer URL</Label>
                <Input
                  value={authConfig.oci_iam.issuer_url}
                  onChange={(e) =>
                    setAuthConfig({
                      ...authConfig,
                      oci_iam: { ...authConfig.oci_iam, issuer_url: e.target.value },
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>OCI Client ID</Label>
                <Input
                  value={authConfig.oci_iam.client_id}
                  onChange={(e) =>
                    setAuthConfig({
                      ...authConfig,
                      oci_iam: { ...authConfig.oci_iam, client_id: e.target.value },
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>OCI Redirect URI</Label>
                <Input
                  value={authConfig.oci_iam.redirect_uri}
                  onChange={(e) =>
                    setAuthConfig({
                      ...authConfig,
                      oci_iam: { ...authConfig.oci_iam, redirect_uri: e.target.value },
                    })
                  }
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Configure the OCI app client redirect URI to this exact value (usually
                <code className="mx-1">https://your-domain/api/auth/oci/callback</code>).
                If your OCI app client uses a secret, set it via <code className="mx-1">AUTH_OCI_CLIENT_SECRET</code>.
              </p>
              <Button type="submit">Save Auth Config</Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Create User</CardTitle>
          <CardDescription>Admins can create and manage local users.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 md:grid-cols-4" onSubmit={createNewUser}>
            <Input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input
              placeholder="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Select value={role} onChange={(e) => setRole(e.target.value === "admin" ? "admin" : "user") }>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </Select>
            <Button type="submit">Create</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {users.map((user) => (
              <div key={user.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                <div>
                  <p className="font-medium">{user.email}</p>
                  <p className="text-muted-foreground">{user.role}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => toggleRole(user)}>
                    Toggle Role
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => removeUser(user)}>
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}
