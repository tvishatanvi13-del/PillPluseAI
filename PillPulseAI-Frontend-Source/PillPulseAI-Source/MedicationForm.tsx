import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { createEvent } from "@/lib/schedule.functions";
import { listPatients } from "@/lib/patients.functions";
import { checkInteractions } from "@/lib/interactions.functions";
import { useActivePatient } from "@/lib/active-patient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, X, AlertTriangle, ShieldCheck, Loader2, Info } from "lucide-react";

type Intake = "before_food" | "with_food" | "after_food";

type Frequency =
  | { kind: "once" }
  | { kind: "daily"; times: string[]; daysOfWeek?: number[] }
  | { kind: "interval"; intervalHours: number; intervalUnit?: "hour" | "day" | "week" }
  | { kind: "weekly"; times: string[]; daysOfWeek: number[]; perWeek?: number }
  | { kind: "prn" };

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MIN_GAP_HOURS = 4;

export type MedicationPrefill = {
  name?: string;
  dosage?: string;
  expiration?: string;
  instructions?: string;
};

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function daysBetween(startISO: string, endISO: string) {
  const a = new Date(startISO + "T00:00:00");
  const b = new Date(endISO + "T00:00:00");
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000) + 1;
}

function addDaysISO(startISO: string, days: number) {
  const d = new Date(startISO + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function dosesPerWeek(freq: Frequency): number {
  if (freq.kind === "daily" || freq.kind === "weekly") {
    const dows = freq.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6];
    return dows.length * (freq.times?.length ?? 0);
  }
  if (freq.kind === "interval") {
    const unit = freq.intervalUnit ?? "hour";
    if (unit === "hour") return Math.floor(24 / freq.intervalHours) * 7;
    if (unit === "day") return Math.ceil(7 / freq.intervalHours);
    if (unit === "week") return Math.max(1, Math.floor(1 / freq.intervalHours));
  }
  return 0;
}

// Returns minimum hour-gap between any two consecutive times in a single day
function minTimeGapHours(times: string[]): number | null {
  if (times.length < 2) return null;
  const mins = times.map((t) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  }).sort((a, b) => a - b);
  let min = Infinity;
  for (let i = 1; i < mins.length; i++) min = Math.min(min, mins[i] - mins[i - 1]);
  return min / 60;
}

export function MedicationForm({
  prefill,
  onSaved,
}: {
  prefill?: MedicationPrefill;
  onSaved?: () => void;
}) {
  const { activePatientId } = useActivePatient();
  const listP = useServerFn(listPatients);
  const create = useServerFn(createEvent);
  const check = useServerFn(checkInteractions);
  const qc = useQueryClient();

  const patientsQ = useQuery({ queryKey: ["patients"], queryFn: () => listP() });

  const [title, setTitle] = useState(prefill?.name ?? "");
  const [dosage, setDosage] = useState(prefill?.dosage ?? "");
  const [notes, setNotes] = useState(prefill?.instructions ?? "");
  const [when, setWhen] = useState(() => {
    const d = new Date(); d.setSeconds(0, 0); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
  const [startDate, setStartDate] = useState<string>(todayISO());
  const [endDate, setEndDate] = useState<string>("");
  const [intake, setIntake] = useState<Intake | "">("");
  const [expires, setExpires] = useState(prefill?.expiration ?? "");
  const [patientId, setPatientId] = useState<string>(activePatientId ?? "");
  const [stockTotal, setStockTotal] = useState<string>("");
  const [refillAt, setRefillAt] = useState<string>("5");
  const [freq, setFreq] = useState<Frequency>({ kind: "daily", times: ["08:00"], daysOfWeek: [0, 1, 2, 3, 4, 5, 6] });
  const [warn, setWarn] = useState<{ severity: "none" | "caution" | "warning"; message: string } | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => { if (prefill?.name) setTitle(prefill.name); }, [prefill?.name]);
  useEffect(() => { if (prefill?.dosage) setDosage(prefill.dosage); }, [prefill?.dosage]);
  useEffect(() => { if (prefill?.expiration) setExpires(prefill.expiration); }, [prefill?.expiration]);
  useEffect(() => { if (prefill?.instructions) setNotes(prefill.instructions); }, [prefill?.instructions]);

  useEffect(() => {
    if (!title.trim() || title.trim().length < 3) { setWarn(null); return; }
    const id = setTimeout(async () => {
      setChecking(true);
      try {
        const r = await check({ data: { med_name: title.trim(), patient_id: patientId || null } });
        setWarn(r);
      } catch { setWarn(null); }
      finally { setChecking(false); }
    }, 700);
    return () => clearTimeout(id);
  }, [title, patientId, check]);

  // Time-gap safeguard
  const timeGapWarn = useMemo(() => {
    if (freq.kind !== "daily" && freq.kind !== "weekly") return null;
    const gap = minTimeGapHours(freq.times);
    if (gap === null) return null;
    if (gap < MIN_GAP_HOURS) {
      return `Times are only ${gap.toFixed(1)}h apart — recommended minimum is ${MIN_GAP_HOURS}h between doses.`;
    }
    return null;
  }, [freq]);

  // Stock cap calculation — explicit boundary check.
  const stockCap = useMemo(() => {
    const stock = stockTotal ? parseInt(stockTotal, 10) : null;
    if (!stock || stock <= 0 || !startDate) return null;
    const dpw = dosesPerWeek(freq);
    if (dpw === 0) return null;
    const dosesPerDay = dpw / 7;
    const stockDays = Math.floor(stock / dosesPerDay);
    if (stockDays <= 0) return null;
    const runOutDate = addDaysISO(startDate, stockDays - 1);
    if (!endDate) {
      return { runOutDate, truncated: false, insufficient: false, stock, required: null as number | null, message: `Stock lasts ~${stockDays} days (until ${runOutDate}).` };
    }
    const requestedDays = daysBetween(startDate, endDate);
    const required = Math.ceil(dosesPerDay * requestedDays);
    if (stock >= required) {
      return { runOutDate: endDate, truncated: false, insufficient: false, stock, required, message: `Stock is sufficient (${required} doses needed over ${requestedDays} days).` };
    }
    return {
      runOutDate,
      truncated: true,
      insufficient: true,
      stock,
      required,
      message: `${stock} tablets is not sufficient for the chosen duration. You need ~${required} doses (${requestedDays} days × ${dosesPerDay.toFixed(2)}/day).`,
    };
  }, [stockTotal, startDate, endDate, freq]);

  const m = useMutation({
    mutationFn: create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      toast.success("Medication added");
      setTitle(""); setDosage(""); setNotes(""); setExpires(""); setStockTotal("");
      setFreq({ kind: "daily", times: ["08:00"], daysOfWeek: [0, 1, 2, 3, 4, 5, 6] });
      setEndDate(""); setIntake("");
      onSaved?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addTime = () => (freq.kind === "daily" || freq.kind === "weekly") && setFreq({ ...freq, times: [...freq.times, "12:00"] });
  const updateTime = (i: number, v: string) =>
    (freq.kind === "daily" || freq.kind === "weekly") && setFreq({ ...freq, times: freq.times.map((t, idx) => idx === i ? v : t) });
  const removeTime = (i: number) =>
    (freq.kind === "daily" || freq.kind === "weekly") && setFreq({ ...freq, times: freq.times.filter((_, idx) => idx !== i) });

  const toggleDay = (d: number) => {
    if (freq.kind !== "daily" && freq.kind !== "weekly") return;
    const cur = freq.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6];
    const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort();
    setFreq({ ...freq, daysOfWeek: next });
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return toast.error("Give it a name");
        if (stockCap?.insufficient) {
          return toast.error(stockCap.message);
        }
        const stock = stockTotal ? parseInt(stockTotal, 10) : null;
        const refill = parseInt(refillAt, 10) || 5;
        const isPrn = freq.kind === "prn";

        const freqWithMeta = freq.kind === "once"
          ? null
          : {
              ...freq,
              start_date: startDate || undefined,
              end_date: endDate || undefined,
              effective_end: stockCap?.truncated ? stockCap.runOutDate : (endDate || undefined),
              intake: intake || undefined,
            };

        m.mutate({
          data: {
            title: title.trim(),
            notes: notes.trim() || null,
            category: "medication",
            scheduled_at: new Date(when).toISOString(),
            expires_at: expires ? new Date(expires).toISOString() : null,
            patient_id: patientId || null,
            dosage: dosage.trim() || null,
            frequency: freqWithMeta,
            prn: isPrn,
            stock_total: stock,
            stock_remaining: stock,
            refill_threshold: refill,
          },
        });
      }}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label htmlFor="med-name">Medication name</Label>
          <Input id="med-name" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Amoxicillin" />
        </div>
        <div>
          <Label htmlFor="med-dose">Dosage</Label>
          <Input id="med-dose" value={dosage} onChange={(e) => setDosage(e.target.value)} placeholder="500mg, 1 tablet" />
        </div>
        <div>
          <Label htmlFor="med-when">First dose date & time</Label>
          <Input id="med-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </div>

        <div>
          <Label>Patient</Label>
          <Select value={patientId || "none"} onValueChange={(v) => setPatientId(v === "none" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Unassigned</SelectItem>
              {(patientsQ.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="med-exp">Expiration (optional)</Label>
          <Input id="med-exp" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </div>
      </div>

      {/* Interaction safety badge */}
      {(checking || warn) && (
        <div className={`flex items-start gap-2 rounded-2xl border px-3 py-2 text-sm ${
          warn?.severity === "warning" ? "border-destructive/40 bg-destructive/5 text-destructive"
          : warn?.severity === "caution" ? "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200"
          : "border-border bg-secondary/40 text-muted-foreground"
        }`}>
          {checking ? <Loader2 className="h-4 w-4 mt-0.5 animate-spin" />
           : warn?.severity === "none" || !warn ? <ShieldCheck className="h-4 w-4 mt-0.5" />
           : <AlertTriangle className="h-4 w-4 mt-0.5" />}
          <span>
            {checking ? "Checking interactions…"
             : warn?.severity === "none" || !warn?.message ? "No interaction concerns detected for this patient."
             : warn.message}
          </span>
        </div>
      )}

      {/* Schedule window + intake */}
      <div className="rounded-2xl border border-border bg-secondary/30 p-4 space-y-3">
        <Label className="text-sm font-semibold">Schedule window</Label>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <Label htmlFor="med-start" className="text-xs">Start date</Label>
            <Input id="med-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="med-end" className="text-xs">End date (optional)</Label>
            <Input id="med-end" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Intake instructions</Label>
            <Select value={intake || "none"} onValueChange={(v) => setIntake(v === "none" ? "" : (v as Intake))}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No instruction</SelectItem>
                <SelectItem value="before_food">Before food</SelectItem>
                <SelectItem value="with_food">With food</SelectItem>
                <SelectItem value="after_food">After food</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Frequency planner */}
      <div className="rounded-2xl border border-border bg-secondary/30 p-4">
        <Label className="text-sm font-semibold">Frequency</Label>
        <div className="mt-2 flex flex-wrap gap-2">
          {([
            { v: "daily", l: "Daily times" },
            { v: "weekly", l: "Specific days" },
            { v: "interval", l: "Every N hours" },
            { v: "once", l: "Once" },
            { v: "prn", l: "As needed (PRN)" },
          ] as const).map((opt) => (
            <button
              type="button"
              key={opt.v}
              onClick={() => {
                if (opt.v === "daily") setFreq({ kind: "daily", times: ["08:00"], daysOfWeek: [0, 1, 2, 3, 4, 5, 6] });
                else if (opt.v === "weekly") setFreq({ kind: "weekly", times: ["09:00"], daysOfWeek: [1, 3, 5], perWeek: 3 });
                else if (opt.v === "interval") setFreq({ kind: "interval", intervalHours: 8, intervalUnit: "hour" });
                else if (opt.v === "once") setFreq({ kind: "once" });
                else setFreq({ kind: "prn" });
              }}
              className={`rounded-full px-3 py-1 text-xs ${freq.kind === opt.v ? "bg-primary text-primary-foreground" : "bg-card border border-border"}`}
            >
              {opt.l}
            </button>
          ))}
        </div>

        {(freq.kind === "daily" || freq.kind === "weekly") && (
          <>
            <div className="mt-3">
              <div className="text-xs font-medium text-muted-foreground mb-1.5">Days of week</div>
              <div className="flex flex-wrap gap-1.5">
                {DOW.map((label, idx) => {
                  const on = (freq.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6]).includes(idx);
                  return (
                    <button
                      type="button"
                      key={idx}
                      onClick={() => toggleDay(idx)}
                      className={`h-8 w-10 rounded-full text-xs font-medium transition ${
                        on ? "bg-sage text-primary-foreground" : "bg-card border border-border text-muted-foreground hover:bg-secondary"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mt-3 space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Time slots ({freq.times.length}/day)</div>
              {freq.times.map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input type="time" value={t} onChange={(e) => updateTime(i, e.target.value)} className="w-32" />
                  {freq.times.length > 1 && (
                    <button type="button" onClick={() => removeTime(i)} className="rounded-full p-1 hover:bg-secondary">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </button>
                  )}
                </div>
              ))}
              <button type="button" onClick={addTime} className="text-xs text-primary underline">+ Add time slot</button>
            </div>
            {timeGapWarn && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{timeGapWarn}</span>
              </div>
            )}
          </>
        )}
        {freq.kind === "interval" && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            Every
            <Input type="number" min={1} max={168} value={freq.intervalHours}
              onChange={(e) => setFreq({ kind: "interval", intervalHours: parseInt(e.target.value, 10) || 1, intervalUnit: freq.intervalUnit ?? "hour" })}
              className="w-20" />
            <Select value={freq.intervalUnit ?? "hour"} onValueChange={(v) => setFreq({ kind: "interval", intervalHours: freq.intervalHours, intervalUnit: v as "hour" | "day" | "week" })}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hour">hour(s)</SelectItem>
                <SelectItem value="day">day(s)</SelectItem>
                <SelectItem value="week">week(s)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {freq.kind === "prn" && (
          <p className="mt-3 text-xs text-muted-foreground">PRN meds are shown in the As-Needed panel, not on the daily timeline.</p>
        )}
      </div>

      {/* Stock tracker */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor="stock">Total stock quantity</Label>
          <Input id="stock" type="number" min={0} placeholder="30" value={stockTotal} onChange={(e) => setStockTotal(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="refill">Refill alert at</Label>
          <Input id="refill" type="number" min={0} value={refillAt} onChange={(e) => setRefillAt(e.target.value)} />
        </div>
      </div>

      {/* Stock cap warning */}
      {stockCap && (
        <div className={`flex items-start gap-2 rounded-2xl border px-3 py-2 text-sm ${
          stockCap.insufficient
            ? "border-destructive/50 bg-destructive/10 text-destructive"
            : stockCap.truncated
            ? "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200"
            : "border-border bg-secondary/40 text-muted-foreground"
        }`}>
          {stockCap.insufficient || stockCap.truncated
            ? <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            : <Info className="h-4 w-4 mt-0.5 shrink-0" />}
          <span>{stockCap.message}</span>
        </div>
      )}

      <div>
        <Label htmlFor="med-notes">Notes</Label>
        <Textarea id="med-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Take with food" />
      </div>

      <Button type="submit" disabled={m.isPending} className="rounded-full">
        <Plus className="mr-1 h-4 w-4" /> {m.isPending ? "Adding…" : "Save medication"}
      </Button>
    </form>
  );
}
