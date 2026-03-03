"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare, Loader2, AlertTriangle } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [authMode, setAuthMode] = useState<"local" | "oci_iam">("local");

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { authMode?: "local" | "oci_iam"; user?: unknown };
      if (data.user) {
        router.replace("/");
        return;
      }
      if (data.authMode) {
        setAuthMode(data.authMode);
      }
    })();
  }, [router]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Login failed");
      setLoading(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  function startOciLogin() {
    window.location.href = "/api/auth/oci/login";
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
            <MessageSquare className="h-5 w-5 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold">Talk-To</h1>
        </div>

        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Welcome back</CardTitle>
            <CardDescription>
              {authMode === "oci_iam"
                ? "OCI IAM is configured. Local login remains available until OIDC callback is wired."
                : "Sign in to chat with AI personas"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin}>
              <div className="space-y-4">
                {authMode === "oci_iam" && (
                  <Button type="button" variant="outline" className="w-full" onClick={startOciLogin}>
                    Sign in with OCI IAM
                  </Button>
                )}
                {searchParams.get("error") && (
                  <p className="text-sm text-destructive-foreground">
                    Sign-in error: {searchParams.get("error")}
                  </p>
                )}
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                {error && (
                  <p className="text-sm text-destructive-foreground">{error}</p>
                )}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="animate-spin" />}
                  Sign In
                </Button>
              </div>
            </form>
          </CardContent>
          <CardFooter className="justify-center">
            <p className="text-sm text-muted-foreground">
              Don&apos;t have an account?{" "}
              <Link href="/signup" className="text-primary hover:underline font-medium">
                Sign up
              </Link>
            </p>
          </CardFooter>
        </Card>

        <Card className="mt-4 border-amber-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              AI Simulation Disclaimer
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-2 leading-relaxed">
            <p>
              This application is an AI-powered simulation tool that generates responses based on
              publicly available podcasts, YouTube videos, social media posts, and other open
              content. All personas are fictional AI constructs and do not represent actual
              individuals, their current views, statements, or affiliations.
            </p>
            <p>
              This app is not affiliated with, endorsed by, or authorized by any real person,
              organization, or estate. It is provided for entertainment, educational, and
              illustrative purposes only.
            </p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Outputs may contain inaccuracies, hallucinations, or outdated information.</li>
              <li>Do not rely on outputs for legal, medical, financial, political, or professional advice.</li>
              <li>Any resemblance to real events/statements is based only on public-source data.</li>
              <li>
                By using this app, you accept that the developer disclaims liability for losses,
                damages, or claims arising from use, including publicity/trademark/defamation claims.
              </li>
            </ul>
            <p>You must be 18+ to use this app. Continued use constitutes acceptance of these terms.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
