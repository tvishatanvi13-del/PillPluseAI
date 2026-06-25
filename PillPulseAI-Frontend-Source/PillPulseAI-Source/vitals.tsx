import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPatients } from "@/lib/patients.functions";
import { listVitals, createVital } from "@/lib/vitals.functions";
import { useActivePatient } from "@/lib/active-patient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Activity, Droplet, HeartPulse, Wind, AlertTriangle, TrendingUp } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { formatDate, formatDateTime } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/vitals")({
  head: () => ({ meta: [{ title: "Vitals — PillPulse AI" }] }),
  component: VitalsPage,
});

type Status = "normal" | "caution" | "critical" | "unset";

const statusBg: Record<Status, string> = {
  normal: "bg-sage/20 text-sage border-sage/40",
  caution: "bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40",
  critical: "bg-destructive/20 text-destructive border-destructive/40 animate-pulse",
  unset: "bg-secondary text-muted-foreground border-border",
};

const statusLabel: Record<Status, string> = {
  normal: "Normal",
  caution: "Caution",
  critical: "Crisis",
  unset: "—",
};

// AHA blood pressure (mmHg)
function bpStatus(sys: number | null, dia: number | null): Status {
  if (sys === null || dia === null) return "unset";
  if (sys >= 180 || dia >= 120) return "critical"; // Hypertensive crisis
  if (sys >= 140 || dia >= 90) return "critical"; // Stage 2
  if (sys >= 130 || dia >= 80) return "caution"; // Stage 1
  if (sys >= 120 && dia < 80) return "caution"; // Elevated
  if (sys < 90 || dia < 60) return "caution"; // Hypotension
  return "normal";
}

// ADA glucose (mg/dL)
function glucoseStatus(v: number | null, state: "fasting" | "post_prandial"): Status {
  if (v === null) return "unset";
  if (state === "fasting") {
    if (v >= 250 || v < 54) return "critical";
    if (v >= 126) return "critical";
    if (v >= 100) return "caution";
    if (v < 70) return "caution";
    return "normal";
  } else {
    if (v >= 300 || v < 54) return "critical";
    if (v >= 200) return "critical";
    if (v >= 140) return "caution";
    if (v < 70) return "caution";
    return "normal";
  }
}

function pulseStatus(v: number | null): Status {
  if (v === null) return "unset";
  if (v >= 130 || v < 40) return "critical";
  if (v >= 100 || v < 50) return "caution";
  return "normal";
}

function spo2Status(v: number | null): Status {
  if (v === null) return "unset";
  if (v < 88) return "critical";
  if (v < 95) return "caution";
  return "normal";
}

function Disclaimer() {
  return (
    <div className="flex items-start gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-900 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>
        <strong>Disclaimer:</strong> This software is for informational tracking purposes only. It does not provide
        medical advice or diagnosis. Always consult a professional physician or qualified healthcare provider for
        medical concerns.
      </p>
    </div>
  );
}

function VitalsPage() {
  const listP = useServerFn(listPatients);
  const listV = useServerFn(listVitals);
  const createV = useServerFn(createVital);
  const qc = useQueryClient();
  const { activePatientId, setActivePatientId } = useActivePatient();

  const patientsQ = useQuery({ queryKey: ["patients"], queryFn: () => listP() });
  const patientId = activePatientId ?? patientsQ.data?.[0]?.id ?? "";

  const vitalsQ = useQuery({
    queryKey: ["vitals", patientId],
    queryFn: () => listV({ data: { patient_id: patientId } }),
    enabled: !!patientId,
  });

  const [sys, setSys] = useState("");
  const [dia, setDia] = useState("");
  const [glucose, setGlucose] = useState("");
  const [fasting, setFasting] = useState(true);
  const [pulse, setPulse] = useState("");
  const [spo2, setSpo2] = useState("");

  const sysN = sys ? parseInt(sys, 10) : null;
  const diaN = dia ? parseInt(dia, 10) : null;
  const glucoseN = glucose ? parseFloat(glucose) : null;
  const pulseN = pulse ? parseInt(pulse, 10) : null;
  const spo2N = spo2 ? parseInt(spo2, 10) : null;

  const bp = useMemo(() => bpStatus(sysN, diaN), [sysN, diaN]);
  const gl = useMemo(() => glucoseStatus(glucoseN, fasting ? "fasting" : "post_prandial"), [glucoseN, fasting]);
  const pl = useMemo(() => pulseStatus(pulseN), [pulseN]);
  const ox = useMemo(() => spo2Status(spo2N), [spo2N]);

  const save = useMutation({
    mutationFn: () => createV({
      data: {
        patient_id: patientId,
        systolic: sysN,
        diastolic: diaN,
        blood_sugar: glucoseN,
        glucose_state: glucoseN !== null ? (fasting ? "fasting" : "post_prandial") : null,
        pulse_bpm: pulseN,
        spo2: spo2N,
      },
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vitals", patientId] });
      setSys(""); setDia(""); setGlucose(""); setPulse(""); setSpo2("");
      toast.success("Vitals logged");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">Vitals tracker</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live color-coded readings against AHA &amp; ADA reference ranges.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
          <span className="text-xs text-muted-foreground">Patient</span>
          <Select value={patientId} onValueChange={setActivePatientId}>
            <SelectTrigger className="h-auto border-0 bg-transparent p-0 text-xs shadow-none focus:ring-0 min-w-32">
              <SelectValue placeholder="Select patient" />
            </SelectTrigger>
            <SelectContent>
              {(patientsQ.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Disclaimer />

      {!patientId ? (
        <div className="rounded-3xl border border-dashed border-border bg-card p-12 text-center text-sm text-muted-foreground">
          Add a patient on the Patients page to begin tracking vitals.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Blood Pressure */}
          <section className={`rounded-3xl border p-5 transition ${statusBg[bp]}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                <h2 className="font-display text-lg font-semibold">Blood Pressure</h2>
              </div>
              <span className="rounded-full bg-background/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">{statusLabel[bp]}</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Systolic</Label>
                <Input type="number" inputMode="numeric" placeholder="120" value={sys} onChange={(e) => setSys(e.target.value)} className="bg-background" />
              </div>
              <div>
                <Label className="text-xs">Diastolic</Label>
                <Input type="number" inputMode="numeric" placeholder="80" value={dia} onChange={(e) => setDia(e.target.value)} className="bg-background" />
              </div>
            </div>
            <p className="mt-3 text-[11px] opacity-80">Normal &lt;120/80 · Elevated 120–129 · Stage 1 130/80 · Stage 2 ≥140/90 · Crisis ≥180/120</p>
          </section>

          {/* Blood Glucose */}
          <section className={`rounded-3xl border p-5 transition ${statusBg[gl]}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Droplet className="h-5 w-5" />
                <h2 className="font-display text-lg font-semibold">Blood Glucose</h2>
              </div>
              <span className="rounded-full bg-background/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">{statusLabel[gl]}</span>
            </div>
            <div className="mt-4 grid grid-cols-[1fr_auto] gap-3 items-end">
              <div>
                <Label className="text-xs">mg/dL</Label>
                <Input type="number" inputMode="decimal" placeholder="95" value={glucose} onChange={(e) => setGlucose(e.target.value)} className="bg-background" />
              </div>
              <div className="flex flex-col items-center gap-1 pb-1">
                <Switch checked={!fasting} onCheckedChange={(v) => setFasting(!v)} />
                <span className="text-[10px] uppercase tracking-wide">{fasting ? "Fasting" : "Post-meal"}</span>
              </div>
            </div>
            <p className="mt-3 text-[11px] opacity-80">
              {fasting ? "Fasting: Normal 70–99 · Pre-diabetic 100–125 · Diabetic ≥126" : "Post-prandial: Normal &lt;140 · Pre-diabetic 140–199 · Diabetic ≥200"}
            </p>
          </section>

          {/* Heart Rate */}
          <section className={`rounded-3xl border p-5 transition ${statusBg[pl]}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HeartPulse className="h-5 w-5" />
                <h2 className="font-display text-lg font-semibold">Heart Rate</h2>
              </div>
              <span className="rounded-full bg-background/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">{statusLabel[pl]}</span>
            </div>
            <div className="mt-4">
              <Label className="text-xs">BPM</Label>
              <Input type="number" inputMode="numeric" placeholder="72" value={pulse} onChange={(e) => setPulse(e.target.value)} className="bg-background" />
            </div>
            <p className="mt-3 text-[11px] opacity-80">Resting normal 60–100 · Caution 50–59 or 100–129 · Critical &lt;40 or ≥130</p>
          </section>

          {/* SpO2 */}
          <section className={`rounded-3xl border p-5 transition ${statusBg[ox]}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wind className="h-5 w-5" />
                <h2 className="font-display text-lg font-semibold">Oxygen Saturation</h2>
              </div>
              <span className="rounded-full bg-background/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">{statusLabel[ox]}</span>
            </div>
            <div className="mt-4">
              <Label className="text-xs">SpO₂ %</Label>
              <Input type="number" inputMode="numeric" placeholder="98" value={spo2} onChange={(e) => setSpo2(e.target.value)} className="bg-background" />
            </div>
            <p className="mt-3 text-[11px] opacity-80">Normal ≥95% · Caution 88–94% · Critical &lt;88%</p>
          </section>
        </div>
      )}

      {patientId && (
        <div className="flex justify-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending} className="rounded-full">
            {save.isPending ? "Saving…" : "Log reading"}
          </Button>
        </div>
      )}

      {/* History */}
      {patientId && (
        <section className="rounded-3xl border border-border bg-card p-6">
          <h2 className="font-display text-lg font-semibold">Recent readings</h2>
          <ul className="mt-3 space-y-2">
            {(vitalsQ.data ?? []).slice(0, 20).map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border bg-secondary/30 p-3 text-sm">
                <span className="text-xs text-muted-foreground">{formatDateTime(v.recorded_at)}</span>
                {v.systolic && v.diastolic && <span>BP {v.systolic}/{v.diastolic}</span>}
                {v.blood_sugar !== null && v.blood_sugar !== undefined && (
                  <span>Glucose {v.blood_sugar} {(v as { glucose_state?: string }).glucose_state === "fasting" ? "(fasting)" : (v as { glucose_state?: string }).glucose_state === "post_prandial" ? "(post-meal)" : ""}</span>
                )}
                {(v as { pulse_bpm?: number | null }).pulse_bpm != null && <span>Pulse {(v as { pulse_bpm?: number | null }).pulse_bpm} bpm</span>}
                {(v as { spo2?: number | null }).spo2 != null && <span>SpO₂ {(v as { spo2?: number | null }).spo2}%</span>}
              </li>
            ))}
            {(vitalsQ.data ?? []).length === 0 && (
              <li className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                No readings yet.
              </li>
            )}
          </ul>
        </section>
      )}

      {/* Trend chart */}
      {patientId && (vitalsQ.data ?? []).length > 0 && (
        <TrendChart data={vitalsQ.data ?? []} />
      )}

      {/* Reference table */}
      <ReferenceTable />

      <Disclaimer />
    </main>
  );
}

type VitalRow = {
  recorded_at: string;
  systolic?: number | null;
  diastolic?: number | null;
  blood_sugar?: number | null;
  pulse_bpm?: number | null;
  spo2?: number | null;
};

function TrendChart({ data }: { data: VitalRow[] }) {
  const points = useMemo(() => {
    return [...data]
      .sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime())
      .map((v) => ({
        t: formatDate(v.recorded_at),
        Systolic: v.systolic ?? null,
        Diastolic: v.diastolic ?? null,
        Glucose: v.blood_sugar ?? null,
        Pulse: v.pulse_bpm ?? null,
        SpO2: v.spo2 ?? null,
      }));
  }, [data]);

  return (
    <section className="rounded-3xl border border-border bg-card p-6">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
        <TrendingUp className="h-5 w-5 text-sage" /> Trends
      </h2>
      <div className="mt-4 h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="t" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="Systolic" stroke="oklch(0.55 0.18 25)" dot connectNulls />
            <Line type="monotone" dataKey="Diastolic" stroke="oklch(0.65 0.14 35)" dot connectNulls />
            <Line type="monotone" dataKey="Glucose" stroke="oklch(0.6 0.15 250)" dot connectNulls />
            <Line type="monotone" dataKey="Pulse" stroke="oklch(0.55 0.18 350)" dot connectNulls />
            <Line type="monotone" dataKey="SpO2" stroke="oklch(0.6 0.14 180)" dot connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function ReferenceTable() {
  const rows: { metric: string; normal: string; caution: string; critical: string }[] = [
    { metric: "Blood Pressure (mmHg)", normal: "< 120 / 80", caution: "120–139 / 80–89", critical: "≥ 140 / 90 or ≥ 180 / 120" },
    { metric: "Glucose Fasting (mg/dL)", normal: "70–99", caution: "100–125", critical: "≥ 126 or < 54" },
    { metric: "Glucose Post-meal (mg/dL)", normal: "< 140", caution: "140–199", critical: "≥ 200 or < 54" },
    { metric: "Heart Rate (BPM)", normal: "60–100", caution: "50–59 or 100–129", critical: "< 40 or ≥ 130" },
    { metric: "Oxygen Saturation (%)", normal: "≥ 95", caution: "88–94", critical: "< 88" },
  ];
  return (
    <section className="rounded-3xl border border-border bg-card p-6">
      <h2 className="font-display text-lg font-semibold">Medical reference ranges</h2>
      <p className="mt-1 text-xs text-muted-foreground">Based on AHA &amp; ADA guidelines.</p>
      <div className="mt-4 overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Metric</th>
              <th className="px-3 py-2 text-left font-medium">Normal</th>
              <th className="px-3 py-2 text-left font-medium">Caution</th>
              <th className="px-3 py-2 text-left font-medium">Critical</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.metric}>
                <td className="px-3 py-2 font-medium">{r.metric}</td>
                <td className="px-3 py-2"><span className="rounded-full bg-sage/15 px-2 py-0.5 text-xs text-sage">{r.normal}</span></td>
                <td className="px-3 py-2"><span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-800 dark:text-amber-200">{r.caution}</span></td>
                <td className="px-3 py-2"><span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs text-destructive">{r.critical}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
