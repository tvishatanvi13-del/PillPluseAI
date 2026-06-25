import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/use-auth";
import { deleteAccount, wipeUserData } from "@/lib/account.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { NotificationsToggle } from "@/components/NotificationsToggle";
import { toast } from "sonner";
import { Trash2, Database, Bell } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — PillPulse AI" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const del = useServerFn(deleteAccount);
  const wipe = useServerFn(wipeUserData);

  const [confirmWipeOpen, setConfirmWipeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const wipeM = useMutation({
    mutationFn: () => wipe(),
    onSuccess: async () => {
      toast.success("Stored data wiped");
      setConfirmWipeOpen(false);
      await qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delM = useMutation({
    mutationFn: () => del({ data: { email, password } }),
    onSuccess: async () => {
      toast.success("Account deleted");
      await supabase.auth.signOut();
      qc.clear();
      navigate({ to: "/" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="font-display text-3xl font-semibold">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Manage notifications, stored data and account preferences.
      </p>

      <section className="mt-6 rounded-3xl border border-border bg-card p-6">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          <Bell className="h-5 w-5 text-[color:var(--color-sage)]" /> Notifications
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pop up reminders when a scheduled dose is due.
        </p>
        <div className="mt-3">
          <NotificationsToggle />
        </div>
      </section>

      <section className="mt-6 rounded-3xl border border-border bg-card p-6">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          <Database className="h-5 w-5 text-[color:var(--color-sage)]" /> Stored data
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Permanently delete all of your patient logs, vitals, scheduled doses, appointments and
          patient entries. Your login details stay intact.
        </p>
        <Button
          variant="outline"
          className="mt-3 rounded-full"
          onClick={() => setConfirmWipeOpen(true)}
        >
          Delete stored data
        </Button>
      </section>

      <section className="mt-6 rounded-3xl border border-border bg-card p-6">
        <h2 className="font-display text-lg font-semibold">Account</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Permanently delete your account and every record tied to it. This cannot be undone.
        </p>
        <Button
          variant="outline"
          className="mt-3 rounded-full"
          onClick={() => {
            setEmail(user?.email ?? "");
            setPassword("");
            setDeleteOpen(true);
          }}
        >
          <Trash2 className="mr-1 h-4 w-4" /> Delete account permanently
        </Button>
      </section>

      {/* Confirm: wipe stored data */}
      <Dialog open={confirmWipeOpen} onOpenChange={setConfirmWipeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Delete all stored data?</DialogTitle>
          <DialogDescription>
            This permanently removes every patient, scheduled dose, appointment, vitals reading
            and dose log on your account. Your sign-in credentials stay intact. This cannot be
            undone.
          </DialogDescription>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmWipeOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={wipeM.isPending}
              onClick={() => wipeM.mutate()}
            >
              {wipeM.isPending ? "Deleting…" : "Yes, delete everything"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm: delete account permanently */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Confirm permanent account deletion</DialogTitle>
          <DialogDescription>
            Re-enter your email and password to confirm. We will erase your profile, patients,
            schedules, vitals and chat history.
          </DialogDescription>
          <form
            className="mt-2 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              delM.mutate();
            }}
          >
            <div>
              <Label htmlFor="del-email">Email / Username</Label>
              <Input
                id="del-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="del-pw">Password</Label>
              <PasswordInput
                id="del-pw"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDeleteOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={delM.isPending}>
                {delM.isPending ? "Deleting…" : "Delete forever"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
