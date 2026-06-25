import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listEvents, listMedicationLogs, listDoseLog, logDose, unlogDose } from "@/lib/schedule.functions";
import { listPatients } from "@/lib/patients.functions";
import { supabase } from "@/integrations/supabase/client";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useActivePatient } from "@/lib/active-patient";
import { cn, formatDate } from "@/lib/utils";
import { Pill, Stethoscope, AlarmClock, AlertTriangle, CalendarClock, Check, Utensils } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/schedule")({
  head: () => ({
    meta: [
      { title: "Schedule — PillPulse AI" },
      { name: "description", content: "Calendar view of medications and appointments." },
    ],
  }),
  component: SchedulePage,
});

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

const iconFor = (c: string) =>
  c === "appointment" ? Stethoscope : c === "expiry" ? AlertTriangle : c === "dose" ? AlarmClock : Pill;

const labelFor = (c: string) =>
  c === "appointment" ? "Appointment" : c === "expiry" ? "Expiry" : c === "dose" ? "Dose" : "Medication";

const intakeLabel: Record<string, string> = {
  before_food: "Before food",
  with_food: "With food",
  after_food: "After food",
};

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dayInRange(day: Date, freq: Frequency | null, eventStart: Date): boolean {
  // Use frequency.start_date if available, else event scheduled_at
  const startISO = freq?.start_date ?? eventStart.toISOString().slice(0, 10);
  const endISO = freq?.effective_end ?? freq?.end_date ?? null;
  const dayISO = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  if (dayISO < startISO) return false;
  if (endISO && dayISO > endISO) return false;
  return true;
}

// Expand into per-slot occurrences with time + slotKey
type Occurrence = { event: Event; time: Date; slotKey: string; intake?: string };

function occurrencesForDay(events: Event[], day: Date, filterPatient: string | null): Occurrence[] {
  const out: Occurrence[] = [];
  const dow = day.getDay();
  const y = day.getFullYear(), m = day.getMonth(), d = day.getDate();

  for (const e of events) {
    if (filterPatient && e.patient_id !== filterPatient) continue;
    if (e.prn) continue;
    const f = (e.frequency as Frequency | null) ?? null;
    const start = new Date(e.scheduled_at);
    if (!dayInRange(day, f, start)) continue;

    if (e.category !== "medication" || !f || f.kind === "once") {
      if (sameDay(day, start)) {
        out.push({ event: e, time: start, slotKey: `once:${e.id}`, intake: f?.intake });
      }
      continue;
    }
    if (f.kind === "daily" || f.kind === "weekly") {
      const days = f.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6];
      if (!days.includes(dow)) continue;
      for (const t of (f.times ?? [])) {
        const [h, mm] = t.split(":").map(Number);
        out.push({
          event: e,
          time: new Date(y, m, d, h, mm, 0, 0),
          slotKey: `${f.kind}:${t}`,
          intake: f.intake,
        });
      }
    } else if (f.kind === "interval" && f.intervalHours) {
      const unit = f.intervalUnit ?? "hour";
      if (unit === "hour") {
        let cur = new Date(y, m, d, start.getHours(), start.getMinutes(), 0, 0);
        const end = new Date(y, m, d, 23, 59, 0, 0);
        while (cur <= end) {
          out.push({
            event: e,
            time: new Date(cur),
            slotKey: `interval:${cur.getHours()}:${cur.getMinutes()}`,
            intake: f.intake,
          });
          cur = new Date(cur.getTime() + f.intervalHours * 3_600_000);
        }
      } else {
        const step = unit === "day" ? f.intervalHours : f.intervalHours * 7;
        const diffDays = Math.floor((Date.UTC(y, m, d) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86_400_000);
        if (diffDays >= 0 && diffDays % step === 0) {
          out.push({
            event: e,
            time: new Date(y, m, d, start.getHours(), start.getMinutes(), 0, 0),
            slotKey: `interval:${start.getHours()}:${start.getMinutes()}`,
            intake: f.intake,
          });
        }
      }
    }
  }
  return out.sort((a, b) => a.time.getTime() - b.time.getTime());
}

function expandedDaysForMonth(events: Event[], year: number, month: number, filterPatient: string | null) {
  const occByDay = new Map<string, number>();
  const last = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= last; d++) {
    const day = new Date(year, month, d);
    const occ = occurrencesForDay(events, day, filterPatient);
    if (occ.length > 0) occByDay.set(`${year}-${month}-${d}`, occ.length);
  }
  return occByDay;
}

function SchedulePage() {
  const list = useServerFn(listEvents);
  const listP = useServerFn(listPatients);
  const listLogs = useServerFn(listMedicationLogs);
  const listLog = useServerFn(listDoseLog);
  const logFn = useServerFn(logDose);
  const unlogFn = useServerFn(unlogDose);
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Date>(new Date());
  const { activePatientId, setActivePatientId } = useActivePatient();

  const q = useQuery({ queryKey: ["events"], queryFn: () => list(), refetchInterval: 60_000 });
  const patientsQ = useQuery({ queryKey: ["patients"], queryFn: () => listP() });
  const logQ = useQuery({ queryKey: ["dose_log_today"], queryFn: () => listLog(), refetchInterval: 60_000 });

  const monthStart = useMemo(() => new Date(selected.getFullYear(), selected.getMonth(), 1), [selected]);
  const monthEnd = useMemo(() => new Date(selected.getFullYear(), selected.getMonth() + 1, 0, 23, 59, 59), [selected]);

  const logsQ = useQuery({
    queryKey: ["med_logs", activePatientId, monthStart.toISOString()],
    queryFn: () => listLogs({ data: { patient_id: activePatientId, since: monthStart.toISOString(), until: monthEnd.toISOString() } }),
  });

  useEffect(() => {
    const ch = supabase
      .channel("schedule_events_cal")
      .on("postgres_changes", { event: "*", schema: "public", table: "schedule_events" }, () => {
        qc.invalidateQueries({ queryKey: ["events"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "dose_log" }, () => {
        qc.invalidateQueries({ queryKey: ["med_logs"] });
        qc.invalidateQueries({ queryKey: ["dose_log_today"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const events = q.data ?? [];
  const monthMap = useMemo(
    () => expandedDaysForMonth(events, selected.getFullYear(), selected.getMonth(), activePatientId),
    [events, selected, activePatientId],
  );

  const eventDays = useMemo(() => {
    const arr: Date[] = [];
    monthMap.forEach((_v, key) => {
      const [y, m, d] = key.split("-").map(Number);
      arr.push(new Date(y, m, d));
    });
    return arr;
  }, [monthMap]);

  const heatmap = useMemo(() => {
    const today = new Date();
    const last = new Date(selected.getFullYear(), selected.getMonth() + 1, 0).getDate();
    const takenByDay = new Map<string, number>();
    for (const log of logsQ.data ?? []) {
      if (!log.created_at) continue;
      const d = new Date(log.created_at);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      takenByDay.set(key, (takenByDay.get(key) ?? 0) + 1);
    }
    const out: { date: Date; scheduled: number; taken: number; status: "none" | "missed" | "partial" | "full" | "future" }[] = [];
    for (let d = 1; d <= last; d++) {
      const date = new Date(selected.getFullYear(), selected.getMonth(), d);
      const key = `${selected.getFullYear()}-${selected.getMonth()}-${d}`;
      const scheduled = monthMap.get(key) ?? 0;
      const taken = takenByDay.get(key) ?? 0;
      const isFuture = date.getTime() > today.getTime() && !sameDay(date, today);
      let status: "none" | "missed" | "partial" | "full" | "future" = "none";
      if (scheduled === 0) status = "none";
      else if (isFuture) status = "future";
      else if (taken === 0) status = "missed";
      else if (taken >= scheduled) status = "full";
      else status = "partial";
      out.push({ date, scheduled, taken, status });
    }
    return out;
  }, [logsQ.data, monthMap, selected]);

  const dayOccurrences = useMemo(
    () => occurrencesForDay(events, selected, activePatientId),
    [events, selected, activePatientId],
  );

  const takenSet = useMemo(() => {
    const today = new Date();
    if (!sameDay(today, selected)) return new Set<string>();
    const s = new Set<string>();
    (logQ.data ?? []).forEach((l) => {
      if (l.slot_key) s.add(`${l.event_id}:${l.slot_key}`);
    });
    return s;
  }, [logQ.data, selected]);

  const toggle = useMutation({
    mutationFn: async (v: { event_id: string; slot_key: string; on: boolean }) => {
      if (v.on) return logFn({ data: { event_id: v.event_id, slot_key: v.slot_key, source: "timeline" } });
      return unlogFn({ data: { event_id: v.event_id, slot_key: v.slot_key } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dose_log_today"] });
      qc.invalidateQueries({ queryKey: ["med_logs"] });
      qc.invalidateQueries({ queryKey: ["events"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isToday = sameDay(selected, new Date());
  const patientName = patientsQ.data?.find((p) => p.id === activePatientId)?.full_name ?? "All patients";

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">Schedule</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A calendar view of every medication, dose and appointment in your household.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
          <span className="text-xs text-muted-foreground">Patient</span>
          <Select value={activePatientId ?? "all"} onValueChange={(v) => setActivePatientId(v === "all" ? null : v)}>
            <SelectTrigger className="h-auto border-0 bg-transparent p-0 text-xs shadow-none focus:ring-0 min-w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All patients</SelectItem>
              {(patientsQ.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[auto_1fr]">
        <div className="rounded-2xl border border-border bg-card p-2">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(d) => d && setSelected(d)}
            modifiers={{ hasEvent: eventDays }}
            modifiersClassNames={{
              hasEvent: "relative font-semibold text-primary after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:h-1 after:w-1 after:rounded-full after:bg-primary",
            }}
            className={cn("p-3 pointer-events-auto")}
          />
        </div>

        <div>
          <h2 className="font-display text-xl font-semibold">
            {formatDate(selected)}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {dayOccurrences.length} {dayOccurrences.length === 1 ? "dose" : "doses"} scheduled
            {!isToday && " · check-off available on the current day"}
          </p>

          {dayOccurrences.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-border bg-card p-10 text-center">
              <CalendarClock className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">Nothing scheduled this day.</p>
            </div>
          ) : (
            <ul className="mt-5 space-y-3">
              {dayOccurrences.map((o) => {
                const Icon = iconFor(o.event.category);
                const slotId = `${o.event.id}:${o.slotKey}`;
                const isTaken = takenSet.has(slotId);
                return (
                  <li
                    key={slotId}
                    className={`flex items-start gap-3 rounded-2xl border p-4 transition ${
                      isTaken ? "border-sage/40 bg-sage/5" : "border-border bg-card"
                    }`}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-sage">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className={`font-medium ${isTaken ? "line-through opacity-60" : ""}`}>{o.event.title}</h3>
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {labelFor(o.event.category)}
                        </span>
                        {o.event.dosage && (
                          <span className="text-xs text-muted-foreground">{o.event.dosage}</span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {o.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </p>
                      {o.intake && (
                        <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-200">
                          <Utensils className="h-3 w-3" /> {intakeLabel[o.intake]}
                        </p>
                      )}
                      {o.event.notes && <p className="mt-2 text-sm text-foreground/80">{o.event.notes}</p>}
                    </div>
                    {isToday && o.event.category === "medication" && (
                      <label className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-xs font-medium hover:bg-secondary">
                        <input
                          type="checkbox"
                          checked={isTaken}
                          disabled={toggle.isPending}
                          onChange={(e) => toggle.mutate({ event_id: o.event.id, slot_key: o.slotKey, on: e.target.checked })}
                          className="h-4 w-4 accent-sage"
                        />
                        {isTaken ? <><Check className="h-3.5 w-3.5 text-sage" /> Taken</> : "Mark taken"}
                      </label>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Dosage history heatmap */}
      <section className="mt-10 rounded-3xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold">Dosage history</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Adherence for <span className="font-medium text-foreground">{patientName}</span> · {selected.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-secondary border border-border" /> No dose</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-destructive/70" /> Missed</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-amber-500/70" /> Partial</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-sage" /> Full</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-secondary/40 border border-dashed border-border" /> Upcoming</span>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-7 gap-1.5 sm:grid-cols-[repeat(auto-fill,minmax(2rem,1fr))]">
          {heatmap.map((cell) => {
            const cls =
              cell.status === "full" ? "bg-sage text-primary-foreground"
              : cell.status === "partial" ? "bg-amber-500/70 text-white"
              : cell.status === "missed" ? "bg-destructive/70 text-destructive-foreground"
              : cell.status === "future" ? "bg-secondary/40 border border-dashed border-border text-muted-foreground"
              : "bg-secondary border border-border text-muted-foreground";
            return (
              <button
                key={cell.date.toISOString()}
                type="button"
                onClick={() => setSelected(cell.date)}
                title={`${formatDate(cell.date)} — ${cell.taken}/${cell.scheduled} doses`}
                className={`aspect-square rounded-md text-[10px] font-medium transition hover:ring-2 hover:ring-ring ${cls}`}
              >
                {cell.date.getDate()}
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
}
