import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/use-auth";
import { listPatients } from "@/lib/patients.functions";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { UserCircle, Users, Mail } from "lucide-react";
import { formatDate } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/accounts")({
  head: () => ({ meta: [{ title: "Account — PillPulse AI" }] }),
  component: AccountsPage,
});

function AccountsPage() {
  const { user } = useAuth();
  const list = useServerFn(listPatients);
  const patientsQ = useQuery({ queryKey: ["patients"], queryFn: () => list() });
  const [profile, setProfile] = useState<{ display_name: string | null; family_name: string | null } | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("display_name, family_name").eq("id", user.id).maybeSingle()
      .then(({ data }) => setProfile(data));
  }, [user]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="font-display text-3xl font-semibold">Account</h1>
      <p className="mt-1 text-sm text-muted-foreground">Your profile and connected family members.</p>

      <section className="mt-6 rounded-3xl border border-border bg-card p-6">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          <UserCircle className="h-5 w-5 text-[color:var(--color-sage)]" /> Profile
        </h2>
        <dl className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <div>
            <dt className="text-xs uppercase text-muted-foreground">Full name</dt>
            <dd className="mt-0.5 font-medium">{profile?.display_name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-muted-foreground">Email / Username</dt>
            <dd className="mt-0.5 inline-flex items-center gap-1 font-medium">
              <Mail className="h-3.5 w-3.5 text-muted-foreground" /> {user?.email ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-muted-foreground">Family</dt>
            <dd className="mt-0.5 font-medium">{profile?.family_name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-muted-foreground">Member since</dt>
            <dd className="mt-0.5 font-medium">
              {formatDate(user?.created_at)}
            </dd>
          </div>
        </dl>
      </section>

      <section className="mt-6 rounded-3xl border border-border bg-card p-6">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          <Users className="h-5 w-5 text-[color:var(--color-sage)]" /> Family members ({patientsQ.data?.length ?? 0})
        </h2>
        {patientsQ.data && patientsQ.data.length > 0 ? (
          <ul className="mt-4 divide-y divide-border">
            {patientsQ.data.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2.5 text-sm">
                <span className="font-medium">{p.full_name}</span>
                <span className="text-xs text-muted-foreground">
                  {p.dob ? `DOB ${formatDate(p.dob)}` : "—"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No family members added yet.</p>
        )}
      </section>
    </main>
  );
}
