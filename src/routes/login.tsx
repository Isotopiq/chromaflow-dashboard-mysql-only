import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import logoAsset from "@/assets/Isotopiq-Logo.png.asset.json";
import { useBranding } from "@/lib/use-branding";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  const { user, loading, refresh } = useAuth();
  const nav = useNavigate();
  const { data: branding } = useBranding();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) nav({ to: "/" });
  }, [user, loading, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Sign-in failed");
      await refresh();
      toast.success("Signed in");
      nav({ to: "/" });
    } catch (err: any) {
      toast.error(err?.message ?? "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm border-border bg-card p-6">
        <div className="mb-6 flex flex-col items-center gap-2">
          <img
            src={branding?.webLogoUrl || logoAsset.url}
            alt={branding?.appName || "Isotopiq"}
            className="h-10 w-auto object-contain"
          />
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Sign in</div>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email" className="text-xs">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password" className="text-xs">Password</Label>
            <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          <Button type="submit" disabled={busy} className="mt-2">{busy ? "Signing in…" : "Sign in"}</Button>
        </form>
        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
          <Link to="/signup" className="hover:text-foreground">Create account</Link>
          <Link to="/reset-password" className="hover:text-foreground">Forgot password?</Link>
        </div>
      </Card>
    </div>
  );
}
