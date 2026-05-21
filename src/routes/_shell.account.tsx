import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Upload, Trash2, UserRound } from "lucide-react";
import {
  getMyAccount,
  updateMyProfile,
  updateMyEmail,
  updateMyPassword,
} from "@/lib/account.functions";
import { createUploadUrl, loadAll } from "@/lib/lab.functions";

export const Route = createFileRoute("/_shell/account")({ component: AccountPage });

function AccountPage() {
  const getAccountFn = useServerFn(getMyAccount);
  const updateProfileFn = useServerFn(updateMyProfile);
  const updateEmailFn = useServerFn(updateMyEmail);
  const updatePasswordFn = useServerFn(updateMyPassword);
  const uploadFn = useServerFn(createUploadUrl);
  const loadAllFn = useServerFn(loadAll);
  const qc = useQueryClient();

  const { data: account, refetch } = useQuery({
    queryKey: ["account"],
    queryFn: () => getAccountFn(),
  });

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (account) {
      setDisplayName(account.displayName ?? "");
      setEmail(account.email ?? "");
    }
  }, [account]);

  const refreshAll = async () => {
    await refetch();
    qc.invalidateQueries({ queryKey: ["lab"] });
    // re-pull current user into the zustand store
    loadAllFn().catch(() => undefined);
  };

  const saveName = async () => {
    const name = displayName.trim();
    if (!name) {
      toast.error("Display name cannot be empty");
      return;
    }
    setSavingName(true);
    try {
      await updateProfileFn({ data: { displayName: name } });
      toast.success("Display name updated");
      await refreshAll();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update name");
    } finally {
      setSavingName(false);
    }
  };

  const saveEmail = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      toast.error("Email is required");
      return;
    }
    setSavingEmail(true);
    try {
      await updateEmailFn({ data: { email: trimmed } });
      toast.success("Email updated");
      await refreshAll();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update email");
    } finally {
      setSavingEmail(false);
    }
  };

  const savePassword = async () => {
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match");
      return;
    }
    setSavingPwd(true);
    try {
      await updatePasswordFn({ data: { password } });
      toast.success("Password updated");
      setPassword("");
      setConfirm("");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update password");
    } finally {
      setSavingPwd(false);
    }
  };

  const onPickFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please pick an image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5 MB");
      return;
    }
    setUploading(true);
    try {
      const up = await uploadFn({
        data: { filename: file.name, bucket: "avatars" },
      });
      const put = await fetch(up.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      await updateProfileFn({ data: { avatarPath: up.path } });
      toast.success("Profile picture updated");
      await refreshAll();
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeAvatar = async () => {
    try {
      await updateProfileFn({ data: { avatarPath: null } });
      toast.success("Profile picture removed");
      await refreshAll();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to remove");
    }
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Account
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Account settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Update your display name, profile picture, email and password.
        </p>
      </div>

      {/* Profile */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold">Profile</h2>
        <div className="mt-4 flex items-start gap-5">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted">
            {account?.avatarUrl ? (
              <img
                src={account.avatarUrl}
                alt="Profile"
                className="h-full w-full object-cover"
              />
            ) : (
              <UserRound className="h-8 w-8 text-muted-foreground" />
            )}
          </div>
          <div className="flex flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onPickFile(f);
                }}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                <Upload className="mr-2 h-3.5 w-3.5" />
                {uploading ? "Uploading…" : "Upload picture"}
              </Button>
              {account?.avatarUrl && (
                <Button size="sm" variant="ghost" onClick={removeAvatar}>
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Remove
                </Button>
              )}
              <span className="text-[11px] text-muted-foreground">
                PNG/JPG, up to 5 MB.
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="display-name" className="text-xs">
                Display name
              </Label>
              <div className="flex gap-2">
                <Input
                  id="display-name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={80}
                />
                <Button onClick={saveName} disabled={savingName} size="sm">
                  {savingName ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Email */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold">Email address</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Used to sign in. Changes take effect immediately.
        </p>
        <div className="mt-4 flex flex-col gap-1.5 sm:max-w-md">
          <Label htmlFor="email" className="text-xs">
            Email
          </Label>
          <div className="flex gap-2">
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Button onClick={saveEmail} disabled={savingEmail} size="sm">
              {savingEmail ? "Saving…" : "Update"}
            </Button>
          </div>
        </div>
      </Card>

      {/* Password */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold">Password</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose a strong password (minimum 8 characters).
        </p>
        <div className="mt-4 grid gap-3 sm:max-w-md">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-pwd" className="text-xs">
              New password
            </Label>
            <Input
              id="new-pwd"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-pwd" className="text-xs">
              Confirm new password
            </Label>
            <Input
              id="confirm-pwd"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <div>
            <Button onClick={savePassword} disabled={savingPwd} size="sm">
              {savingPwd ? "Updating…" : "Update password"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
