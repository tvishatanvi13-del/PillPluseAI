import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listEvents, listDoseLog, toggleEvent, deleteEvent } from "@/lib/schedule.functions";
import { supabase } from "@/integrations/supabase/client";
import { Check, Trash2, Pill, Stethoscope, AlarmClock, AlertTriangle, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/utils";

type Event = Awaited<ReturnType<typeof listEvents>>[number];

const iconFor = (c: string) =>
  c === "appointment" ? Stethoscope : c === "expiry" ? AlertTriangle : c === "dose" ? AlarmClock : Pill;

const labelFor = (c: string) =>
  c === "appointment" ? "Appointment" : c === "expiry" ? "Expiry" : c === "dose" ? "Dose" : "Medication";

function status(e: Event) {
  const now = Date.now();
  const sched = new Date(e.scheduled_at).getTime();
  const exp = e.expires_at ? new Date(e.expires_at).getTime() : null;
  if (e.completed) return { kind: "done" as const };
  if (exp && exp <= now) return { kind: "expired" as const, reason: "Expired" };
  if (!e.completed && sched <= now && e.category !== "appointment") {
    return { kind: "expired" as const, reason: "Due / missed" };
  }
  if (e.category === "appointment" && sched - now < 24 * 3600 * 1000 && sched - now > 0) {
    return { kind: "soon" as const, reason: "Within 24h" };
  }
  return { kind: "upcoming" as const };
}

function relative(iso: string) {
  const d = new Date(iso).getTime();
  const diff = d - Date.now();
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60000);
  const h = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  const txt = m < 60 ? `${m}m` : h < 24 ? `${h}h` : `${days}d`;
  return diff >= 0 ? `in ${txt}` : `${txt} ago`;
}

export function Timeline() {
  const list = useServerFn(listEvents);
  const listLog = useServerFn(listDoseLog);
  const toggle = useServerFn(toggleEvent);
  const remove = useServerFn(deleteEvent);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["events"],
    queryFn: () => list(),
    refetchInterval: 60_000,
  });

  const logQ = useQuery({
    queryKey: ["dose_log_today"],
    queryFn: () => listLog(),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const ch = supabase
      .channel("timeline-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "schedule_events" }, () => {
        qc.invalidateQueries({ queryKey: ["events"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "dose_log" }, () => {
        qc.invalidateQueries({ queryKey: ["dose_log_today"] });
        qc.invalidateQueries({ queryKey: ["events"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const loggedEventIds = useMemo(() => {
    const s = new Set<string>();
    (logQ.data ?? []).forEach((l) => l.event_id && s.add(l.event_id));
    return s;
  }, [logQ.data]);

  const events = useMemo<Event[]>(
    () => (q.data ?? []).map((e) => (loggedEventIds.has(e.id) ? { ...e, completed: true } : e)),
    [q.data, loggedEventIds],
  );

  const groups = useMemo(() => {
    const out: Record<string, Event[]> = {};
    events.forEach((e) => {
      const k = new Date(e.scheduled_at).toDateString();
      (out[k] ||= []).push(e);
    });
    return out;
  }, [events]);

  const mT = useMutation({
    mutationFn: (v: { id: string; completed: boolean }) => toggle({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["events"] }),
  });
  const mD = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["events"] }); toast.success("Removed"); },
  });

  return (
    <section className="mt-8">
      <h2 className="font-display text-xl font-semibold">Family timeline</h2>
      <p className="mt-1 text-sm text-muted-foreground">Auto-updates as anyone in your household adds or completes items.</p>

      {q.isLoading && <p className="mt-6 text-sm text-muted-foreground">Loading…</p>}
      {!q.isLoading && (q.data?.length ?? 0) === 0 && (
        <div className="mt-6 rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <CalendarClock className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">No events yet — add your first above.</p>
        </div>
      )}

      <div className="mt-5 space-y-6">
        {Object.entries(groups).map(([day, items]) => (
          <div key={day}>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{day}</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {items.map((e) => {
                const s = status(e);
                const Icon = iconFor(e.category);
                const cardClass =
                  s.kind === "expired" ? "border-destructive/40 bg-destructive/5"
                  : s.kind === "soon" ? "border-warning/50 bg-warning/10"
                  : s.kind === "done" ? "border-border bg-secondary/40 opacity-70"
                  : "border-border bg-card";
                return (
                  <article key={e.id} className={`rounded-2xl border p-4 transition ${cardClass}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                          s.kind === "expired" ? "bg-destructive text-destructive-foreground"
                          : s.kind === "soon" ? "bg-warning text-warning-foreground"
                          : "bg-secondary text-sage"
                        }`}>
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className={`font-medium ${s.kind === "done" ? "line-through" : ""}`}>{e.title}</h3>
                            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                              {labelFor(e.category)}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {formatDateTime(e.scheduled_at)} · {relative(e.scheduled_at)}
                          </p>
                          {e.notes && <p className="mt-2 text-sm text-foreground/80">{e.notes}</p>}
                          {s.kind === "expired" && (
                            <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-destructive px-2 py-0.5 text-xs font-semibold text-destructive-foreground">
                              ⚠️ EXPIRED OR DUE — {s.reason}
                            </p>
                          )}
                          {s.kind === "soon" && (
                            <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-warning px-2 py-0.5 text-xs font-semibold text-warning-foreground">
                              ⏰ Within 24 hours
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => mT.mutate({ id: e.id, completed: !e.completed })}
                          className="rounded-full p-2 hover:bg-secondary"
                          aria-label="Toggle complete"
                          title={e.completed ? "Mark as not done" : "Mark as done"}
                        >
                          <Check className={`h-4 w-4 ${e.completed ? "text-sage" : "text-muted-foreground"}`} />
                        </button>
                        <button
                          onClick={() => mD.mutate(e.id)}
                          className="rounded-full p-2 hover:bg-secondary"
                          aria-label="Delete"
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
