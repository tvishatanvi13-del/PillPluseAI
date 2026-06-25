import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listEvents, listDoseLog, logDose, toggleEvent } from "@/lib/schedule.functions";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, X, Pill, Stethoscope } from "lucide-react";
import { toast } from "sonner";

type Event = Awaited<ReturnType<typeof listEvents>>[number];
type Frequency = {
  kind: "daily" | "interval" | "custom" | "prn" | "once" | "weekly";
  times?: string[];
  daysOfWeek?: number[];
  start_date?: string;
  end_date?: string;
  effective_end?: string;
};

type Due = { id: string; event: Event; at: Date; slotKey: string };

const LEAD_MIN = 0;        // fire at scheduled time
const WINDOW_MIN = 15;     // surface for 15 min after due

function dueNowList(events: Event[], taken: Set<string>): Due[] {
  const now = new Date();
  const yyyy = now.getFullYear(), mm = now.getMonth(), dd = now.getDate();
  const dow = now.getDay();
  const todayISO = `${yyyy}-${String(mm + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  const out: Due[] = [];

  for (const e of events) {
    if (e.completed) continue;
    if (e.category === "appointment") {
      const at = new Date(e.scheduled_at);
      const diff = (at.getTime() - now.getTime()) / 60000;
      if (diff <= LEAD_MIN && diff >= -WINDOW_MIN) {
        out.push({ id: `appt:${e.id}`, event: e, at, slotKey: `appt:${e.id}` });
      }
      continue;
    }
    if (e.category !== "medication" || e.prn) continue;
    const f = (e.frequency as Frequency | null) ?? null;
    if (f?.start_date && todayISO < f.start_date) continue;
    const effEnd = f?.effective_end ?? f?.end_date;
    if (effEnd && todayISO > effEnd) continue;

    const slots: { time: Date; key: string }[] = [];
    if ((f?.kind === "daily" || f?.kind === "weekly") && f.times?.length) {
      const days = f.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6];
      if (!days.includes(dow)) continue;
      for (const t of f.times) {
        const [h, mn] = t.split(":").map((n) => parseInt(n, 10));
        slots.push({ time: new Date(yyyy, mm, dd, h, mn, 0, 0), key: `${f.kind}:${t}` });
      }
    } else if (!f || f.kind === "once") {
      const s = new Date(e.scheduled_at);
      if (s.getFullYear() === yyyy && s.getMonth() === mm && s.getDate() === dd) {
        slots.push({ time: s, key: `once:${e.id}` });
      }
    }
    for (const s of slots) {
      const diff = (s.time.getTime() - now.getTime()) / 60000;
      if (diff <= LEAD_MIN && diff >= -WINDOW_MIN) {
        const key = `${e.id}:${s.key}`;
        if (!taken.has(key)) out.push({ id: key, event: e, at: s.time, slotKey: s.key });
      }
    }
  }
  return out;
}

export function UpcomingDoseModal() {
  const list = useServerFn(listEvents);
  const listLog = useServerFn(listDoseLog);
  const logFn = useServerFn(logDose);
  const toggleFn = useServerFn(toggleEvent);
  const qc = useQueryClient();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [tick, setTick] = useState(0);

  const eventsQ = useQuery({ queryKey: ["events"], queryFn: () => list(), refetchInterval: 60_000 });
  const logQ = useQuery({ queryKey: ["dose_log_today"], queryFn: () => listLog(), refetchInterval: 60_000 });

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const taken = useMemo(() => {
    const s = new Set<string>();
    (logQ.data ?? []).forEach((l) => l.slot_key && s.add(`${l.event_id}:${l.slot_key}`));
    return s;
  }, [logQ.data]);

  const due = useMemo(
    () => dueNowList(eventsQ.data ?? [], taken).filter((d) => !dismissed.has(d.id)),
    // include tick so it re-evaluates over time
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eventsQ.data, taken, dismissed, tick],
  );

  const current = due[0] ?? null;

  const markDone = useMutation({
    mutationFn: async () => {
      if (!current) return;
      if (current.event.category === "appointment") {
        await toggleFn({ data: { id: current.event.id, completed: true } });
      } else {
        await logFn({ data: { event_id: current.event.id, slot_key: current.slotKey, source: "timeline" } });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dose_log_today"] });
      qc.invalidateQueries({ queryKey: ["events"] });
      toast.success("Marked complete");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!current) return null;
  const Icon = current.event.category === "appointment" ? Stethoscope : Pill;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) setDismissed((s) => new Set(s).add(current.id)); }}>
      <DialogContent className="sm:max-w-md">
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setDismissed((s) => new Set(s).add(current.id))}
          className="absolute right-3 top-3 rounded-full p-1.5 text-muted-foreground hover:bg-secondary"
        >
          <X className="h-4 w-4" />
        </button>
        <DialogTitle className="flex items-center gap-2 font-display text-xl">
          <Icon className="h-5 w-5 text-[color:var(--color-sage)]" />
          Time for {current.event.title}
        </DialogTitle>
        <DialogDescription>
          Scheduled for {current.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          {current.event.dosage ? ` · ${current.event.dosage}` : ""}
        </DialogDescription>
        <div className="mt-3 rounded-2xl border border-border bg-secondary/30 p-4">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              className="h-5 w-5 accent-[color:var(--color-sage)]"
              checked={markDone.isPending}
              onChange={() => markDone.mutate()}
            />
            <span className="text-sm font-medium">
              Mark as taken / completed
            </span>
            {markDone.isPending && <Check className="ml-auto h-4 w-4 text-[color:var(--color-sage)]" />}
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => setDismissed((s) => new Set(s).add(current.id))}
          >
            Dismiss
          </Button>
          <Button
            onClick={() => { markDone.mutate(); setDismissed((s) => new Set(s).add(current.id)); }}
            disabled={markDone.isPending}
          >
            <Check className="mr-1 h-4 w-4" /> Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
