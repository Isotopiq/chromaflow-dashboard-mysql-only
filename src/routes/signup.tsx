import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getSupabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { validateInviteCode, consumeInviteCode } from "@/lib/branding.functions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { FlaskConical } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/signup")({ component: SignupPage });

function SignupPage() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const validateFn = useServerFn(validateInviteCode);
  const consumeFn = useServerFn(consumeInviteCode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) nav({ to: "/" });
  }, [user, loading, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    const code = inviteCode.trim().toUpperCase();
    if (!code) {
      toast.error("Invite code is required");
      return;
    }
    setBusy(true);
    try {
      // 1. Pre-validate the invite code so we don't create orphan accounts.
      const check = await validateFn({ data: { code } });
      if (!check.ok) {
        toast.error(check.reason ?? "Invalid invite code");
        return;
      }

      // 2. Create the auth user.
      const sb = await getSupabase();
      const { data: signed, error } = await sb.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin,
          data: { display_name: name || email.split("@")[0] },
        },
      });
      if (error) throw error;
      const newUserId = signed.user?.id;
      if (!newUserId) {
        toast.success("Account created — check your email to verify, then sign in");
        nav({ to: "/login" });
        return;
      }

      // 3. Claim the code + assign role.
      try {
        await consumeFn({ data: { code, newUserId } });
      } catch (claimErr: any) {
        console.error("Invite claim failed", claimErr);
        toast.error(
          `Account created but invite claim failed: ${claimErr?.message ?? "unknown"}. Contact an admin.`,
        );
      }

      toast.success("Account created — check your email to verify, then sign in");
      nav({ to: "/login" });
    } catch (err: any) {
      toast.error(err?.message ?? "Sign-up failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm border-border bg-card p-6">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <FlaskConical className="h-4 w-4" />
          </div>
          <div className="leading-tight">
            <div className="font-mono text-sm font-semibold">CHROMA.LAB</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Create account
            </div>
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite" className="text-xs">Invite code</Label>
            <Input
              id="invite"
              required
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              placeholder="XXXX-XXXX-XXXX"
              className="font-mono uppercase tracking-widest"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name" className="text-xs">Display name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email" className="text-xs">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password" className="text-xs">Password (min 8)</Label>
            <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button type="submit" disabled={busy} className="mt-2">
            {busy ? "Creating…" : "Create account"}
          </Button>
        </form>

        <div className="mt-4 text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link to="/login" className="text-foreground hover:underline">
            Sign in
          </Link>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Sign-ups require an invite code issued by an admin from the admin dashboard.
        </p>
      </Card>
    </div>
  );
}
