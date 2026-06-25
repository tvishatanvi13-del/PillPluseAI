import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listEvents, listDoseLog, logDose, unlogDose } from "@/lib/schedule.functions";
import { useActivePatient } from "@/lib/active-patient";
import { Check, Pill, AlertTriangle, PackageX } from "lucide-react";
import { toast } from "sonner";

type Event = Awaited<ReturnType<typeof listEvents>>[number];
type Frequency = {
  kind: "daily" | "interval" | "custom" | "prn" | "once" | "weekly";
  times?: string[];
  intervalHours?: number;
  intervalUnit?: "hour" | "day" | "week";
  daysOfWeek?: number[];
  start_date?: string;
  end_date?: string;
  effective_end?: string;
  intake?: "before_food" | "with_food" | "after_food";
};

function todayDoses(events: Event[], filterPatient: string | null) {
  const slots: { event: Event; time: Date; slotKey: string }[] = [];
  const today = new Date();
  const yyyy = today.getFullYear(), mm = today.getMonth(), dd = today.getDate();
  const dow = today.getDay();
  const todayISO = `${yyyy}-${String(mm + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;

  for (const e of events) {
    if (e.category !== "medication") continue;
    if (e.prn) continue;
    if (filterPatient && e.patient_id !== filterPatient) continue;
    const f = (e.frequency as Frequency | null) ?? null;

    // Honor schedule window
    if (f?.start_date && todayISO < f.start_date) continue;
    const effEnd = f?.effective_end ?? f?.end_date;
    if (effEnd && todayISO > effEnd) continue;

    if ((f?.kind === "daily" || f?.kind === "weekly") && f.times?.length) {
      const days = f.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6];
      if (!days.includes(dow)) continue;
      for (const t of f.times) {
        const [h, m] = t.split(":").map((n) => parseInt(n, 10));
        const d = new Date(yyyy, mm, dd, h, m, 0, 0);
        slots.push({ event: e, time: d, slotKey: `${f.kind}:${t}` });
      }
    } else if (f?.kind === "interval" && f.intervalHours) {
      const unit = f.intervalUnit ?? "hour";
      if (unit !== "hour") {
        // Day/week intervals — only show on aligned days
        const start = new Date(e.scheduled_at);
        const daysSince = Math.floor((Date.UTC(yyyy, mm, dd) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86400_000);
        const step = unit === "day" ? f.intervalHours : f.intervalHours * 7;
        if (daysSince < 0 || daysSince % step !== 0) continue;
        slots.push({ event: e, time: new Date(yyyy, mm, dd, start.getHours(), start.getMinutes(), 0, 0), slotKey: `interval:${start.getHours()}:${start.getMinutes()}` });
      } else {
        const start = new Date(e.scheduled_at);
        let cur = new Date(yyyy, mm, dd, start.getHours(), start.getMinutes(), 0, 0);
        const end = new Date(yyyy, mm, dd, 23, 59, 0, 0);
        while (cur <= end) {
          slots.push({
            event: e, time: new Date(cur),
            slotKey: `interval:${cur.getHours()}:${cur.getMinutes()}`,
          });
          cur = new Date(cur.getTime() + f.intervalHours * 3600_000);
        }
      }
    } else {
      const s = new Date(e.scheduled_at);
      if (s.getFullYear() === yyyy && s.getMonth() === mm && s.getDate() === dd) {
        slots.push({ event: e, time: s, slotKey: `once:${e.id}` });
      }
    }
  }
  return slots.sort((a, b) => a.time.getTime() - b.time.getTime());
}

export function DailyTimeline() {
  const list = useServerFn(listEvents);
  const listLog = useServerFn(listDoseLog);
  const logFn = useServerFn(logDose);
  const unlogFn = useServerFn(unlogDose);
  const qc = useQueryClient();
  const { activePatientId } = useActivePatient();

  const eventsQ = useQuery({ queryKey: ["events"], queryFn: () => list(), refetchInterval: 60_000 });
  const logQ = useQuery({ queryKey: ["dose_log_today"], queryFn: () => listLog(), refetchInterval: 60_000 });

  const slots = useMemo(
    () => todayDoses(eventsQ.data ?? [], activePatientId),
    [eventsQ.data, activePatientId],
  );

  const takenKey = (eventId: string, slotKey: string) => `${eventId}:${slotKey}`;
  const taken = useMemo(() => {
    const s = new Set<string>();
    (logQ.data ?? []).forEach((l) => {
      if (l.slot_key) s.add(takenKey(l.event_id, l.slot_key));
    });
    return s;
  }, [logQ.data]);

  const toggle = useMutation({
    mutationFn: async (v: { event_id: string; slot_key: string; on: boolean }) => {
      if (v.on) return logFn({ data: { event_id: v.event_id, slot_key: v.slot_key, source: "timeline" } });
      return unlogFn({ data: { event_id: v.event_id, slot_key: v.slot_key } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dose_log_today"] });
      qc.invalidateQueries({ queryKey: ["events"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Group slots by HH:MM display
  const grouped = useMemo(() => {
    const g: Record<string, typeof slots> = {};
    for (const s of slots) {
      const k = s.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      (g[k] ||= []).push(s);
    }
    return g;
  }, [slots]);

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold">Today's doses</h2>
          <p className="mt-1 text-sm text-muted-foreground">Check off each dose as it's taken — stock updates automatically.</p>
        </div>
      </div>

      {slots.length === 0 && (
        <div className="mt-4 rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          No doses scheduled for today.
        </div>
      )}

      <div className="mt-4 space-y-4">
        {Object.entries(grouped).map(([time, items]) => (
          <div key={time}>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{time}</div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {items.map(({ event, slotKey }) => {
                const isTaken = taken.has(takenKey(event.id, slotKey));
                const low = event.stock_remaining !== null && event.stock_remaining !== undefined
                  && event.stock_remaining <= (event.refill_threshold ?? 5);
                const empty = event.stock_remaining === 0;
                return (
                  <label
                    key={`${event.id}:${slotKey}`}
                    className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition ${
                      isTaken ? "border-sage/40 bg-sage/5" : "border-border bg-card hover:bg-secondary/40"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isTaken}
                      disabled={toggle.isPending}
                      onChange={(e) => toggle.mutate({ event_id: event.id, slot_key: slotKey, on: e.target.checked })}
                      className="mt-1 h-5 w-5 accent-sage"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill className="h-4 w-4 text-sage" />
                        <span className={`font-medium ${isTaken ? "line-through text-muted-foreground" : ""}`}>{event.title}</span>
                        {event.dosage && <span className="text-xs text-muted-foreground">{event.dosage}</span>}
                        {event.stock_remaining !== null && event.stock_remaining !== undefined && (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            empty ? "bg-destructive text-destructive-foreground"
                            : low ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                            : "bg-secondary text-muted-foreground"
                          }`}>
                            {event.stock_remaining} left
                          </span>
                        )}
                        {low && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                            {empty ? <PackageX className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                            Refill
                          </span>
                        )}
                      </div>
                    </div>
                    {isTaken && <Check className="h-4 w-4 text-sage" />}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
