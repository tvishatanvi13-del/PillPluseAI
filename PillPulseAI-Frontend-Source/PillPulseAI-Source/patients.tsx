import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPatients, createPatient, updatePatient, deletePatient } from "@/lib/patients.functions";
import { listVitals, createVital, deleteVital } from "@/lib/vitals.functions";
import { useActivePatient } from "@/lib/active-patient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, User, Activity } from "lucide-react";
import { formatDateTime } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/patients")({
  head: () => ({ meta: [{ title: "Patients — PillPulse AI" }] }),
  component: PatientsPage,
});

function age(dob: string | null) {
  if (!dob) return null;
  const d = new Date(dob);
  const diff = Date.now() - d.getTime();
  return Math.floor(diff / (365.25 * 86400_000));
}

function bmi(h: number | null, w: number | null) {
  if (!h || !w) return null;
  const m = h / 100;
  return +(w / (m * m)).toFixed(1);
}
function bmiClass(v: number | null) {
  if (v === null) return null;
  if (v < 18.5) return { label: "Underweight", cls: "bg-amber-500/20 text-amber-700 dark:text-amber-300" };
  if (v < 25) return { label: "Normal", cls: "bg-sage/20 text-sage" };
  if (v < 30) return { label: "Overweight", cls: "bg-amber-500/20 text-amber-700 dark:text-amber-300" };
  return { label: "Obese", cls: "bg-destructive/15 text-destructive" };
}

function PatientsPage() {
  const list = useServerFn(listPatients);
  const create = useServerFn(createPatient);
  const update = useServerFn(updatePatient);
  const del = useServerFn(deletePatient);
  const qc = useQueryClient();
  const { activePatientId, setActivePatientId } = useActivePatient();

  const q = useQuery({ queryKey: ["patients"], queryFn: () => list() });

  // Auto-select first patient
  useEffect(() => {
    if (!activePatientId && q.data && q.data.length > 0) setActivePatientId(q.data[0].id);
  }, [q.data, activePatientId, setActivePatientId]);

  const [newName, setNewName] = useState("");
  const mCreate = useMutation({
    mutationFn: (full_name: string) => create({ data: { full_name } }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["patients"] });
      setNewName("");
      setActivePatientId(row.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mDel = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patients"] });
      setActivePatientId(null);
      toast.success("Removed");
    },
  });

  const active = q.data?.find((p) => p.id === activePatientId) ?? null;

  return (
    <main className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-6 py-8 md:grid-cols-[260px_1fr]">
      {/* Sidebar */}
      <aside className="rounded-3xl border border-border bg-card p-4">
        <h2 className="px-2 font-display text-lg font-semibold">Patients</h2>
        <ul className="mt-3 space-y-1">
          {(q.data ?? []).map((p) => (
            <li key={p.id} className="group flex items-center gap-1">
              <button
                onClick={() => setActivePatientId(p.id)}
                className={`flex-1 truncate rounded-xl px-3 py-2 text-left text-sm transition ${
                  activePatientId === p.id ? "bg-primary text-primary-foreground" : "hover:bg-secondary"
                }`}
              >
                <User className="mr-2 inline h-3.5 w-3.5" /> {p.full_name}
              </button>
              <button onClick={() => mDel.mutate(p.id)} className="rounded-full p-1.5 opacity-0 hover:bg-destructive/10 group-hover:opacity-100">
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
        <form
          onSubmit={(e) => { e.preventDefault(); if (newName.trim()) mCreate.mutate(newName.trim()); }}
          className="mt-4 space-y-2"
        >
          <Input placeholder="New patient name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Button type="submit" size="sm" className="w-full rounded-full" disabled={mCreate.isPending}>
            <Plus className="mr-1 h-4 w-4" /> Add patient
          </Button>
        </form>
      </aside>

      {/* Detail */}
      <div className="space-y-6">
        {!active && (
          <div className="rounded-3xl border border-dashed border-border bg-card p-12 text-center text-sm text-muted-foreground">
            Select or add a patient.
          </div>
        )}
        {active && (
          <>
            <PatientProfileCard
              key={active.id}
              patient={active}
              onSave={(patch) => update({ data: { id: active.id, patch } }).then(() => qc.invalidateQueries({ queryKey: ["patients"] }))}
            />
            <VitalsCard patientId={active.id} />
          </>
        )}
      </div>
    </main>
  );
}

function PatientProfileCard({
  patient,
  onSave,
}: {
  patient: { id: string; full_name: string; dob: string | null; gender?: string | null; height_cm: number | null; weight_kg: number | null; allergies: string[]; notes: string | null; medical_history?: string | null; emergency_contact_name?: string | null; emergency_contact_phone?: string | null; emergency_contact_email?: string | null };
  onSave: (patch: Record<string, unknown>) => Promise<unknown>;
}) {
  const [fullName, setFullName] = useState(patient.full_name);
  const [dob, setDob] = useState(patient.dob ?? "");
  const [gender, setGender] = useState<string>(patient.gender ?? "");
  const [height, setHeight] = useState(patient.height_cm?.toString() ?? "");
  const [weight, setWeight] = useState(patient.weight_kg?.toString() ?? "");
  const [allergies, setAllergies] = useState((patient.allergies ?? []).join(", "));
  const [notes, setNotes] = useState(patient.notes ?? "");
  const [history, setHistory] = useState(patient.medical_history ?? "");
  const [ecName, setEcName] = useState(patient.emergency_contact_name ?? "");
  const [ecPhone, setEcPhone] = useState(patient.emergency_contact_phone ?? "");
  const [ecEmail, setEcEmail] = useState(patient.emergency_contact_email ?? "");

  const h = parseFloat(height) || null;
  const w = parseFloat(weight) || null;
  const b = bmi(h, w);
  const cls = bmiClass(b);
  const currentAge = age(dob);

  // Position of marker on 0..40 BMI strip (clamped 10-40)
  const markerPct = b !== null ? Math.min(100, Math.max(0, ((b - 10) / 30) * 100)) : null;

  return (
    <section className="rounded-3xl border border-border bg-card p-6">
      <h2 className="font-display text-xl font-semibold">{patient.full_name}</h2>
      <form
        className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            full_name: fullName.trim(),
            dob: dob || null,
            gender: gender || null,
            height_cm: h,
            weight_kg: w,
            allergies: allergies.split(",").map((s) => s.trim()).filter(Boolean),
            notes: notes || null,
            medical_history: history || null,
            emergency_contact_name: ecName.trim() || null,
            emergency_contact_phone: ecPhone.trim() || null,
            emergency_contact_email: ecEmail.trim() || null,
          }).then(() => toast.success("Saved"));
        }}
      >
        <div>
          <Label>Full name</Label>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div>
          <Label>Date of birth {currentAge !== null && <span className="text-xs text-muted-foreground">· age {currentAge}</span>}</Label>
          <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
        </div>
        <div>
          <Label>Gender</Label>
          <Select value={gender || "unset"} onValueChange={(v) => setGender(v === "unset" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Not specified" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unset">Not specified</SelectItem>
              <SelectItem value="male">Male</SelectItem>
              <SelectItem value="female">Female</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Height (cm)</Label>
          <Input type="number" value={height} onChange={(e) => setHeight(e.target.value)} />
        </div>
        <div>
          <Label>Weight (kg)</Label>
          <Input type="number" value={weight} onChange={(e) => setWeight(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <Label>Allergies (comma-separated)</Label>
          <Input value={allergies} onChange={(e) => setAllergies(e.target.value)} placeholder="penicillin, peanuts" />
        </div>
        <div className="md:col-span-2">
          <Label>Notes</Label>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <Label>Medical history</Label>
          <Textarea rows={3} value={history} onChange={(e) => setHistory(e.target.value)} placeholder="Conditions, surgeries, ongoing treatments…" />
        </div>

        {/* Emergency contacts (required) */}
        <div className="md:col-span-2 rounded-2xl border border-border bg-secondary/30 p-4">
          <Label className="text-sm font-semibold">Emergency contact <span className="text-destructive">*</span></Label>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <Label className="text-xs">Name</Label>
              <Input required value={ecName} onChange={(e) => setEcName(e.target.value)} placeholder="Jane Doe" />
            </div>
            <div>
              <Label className="text-xs">Phone</Label>
              <Input required type="tel" value={ecPhone} onChange={(e) => setEcPhone(e.target.value)} placeholder="+1 555 010 1234" />
            </div>
            <div>
              <Label className="text-xs">Email (optional)</Label>
              <Input type="email" value={ecEmail} onChange={(e) => setEcEmail(e.target.value)} placeholder="jane@example.com" />
            </div>
          </div>
        </div>

        {/* BMI card + reference chart */}
        <div className="md:col-span-2 rounded-2xl border border-border bg-secondary/30 p-4">
          <div className="flex items-center gap-2">
            <span className="font-display text-2xl font-semibold">{b ?? "—"}</span>
            <span className="text-xs text-muted-foreground">BMI</span>
            {cls && <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${cls.cls}`}>{cls.label}</span>}
          </div>
          <div className="mt-3">
            <div className="relative h-3 w-full overflow-hidden rounded-full">
              <div className="absolute inset-y-0 left-0 bg-amber-500/40" style={{ width: `${((18.5 - 10) / 30) * 100}%` }} />
              <div className="absolute inset-y-0 bg-sage/50" style={{ left: `${((18.5 - 10) / 30) * 100}%`, width: `${((25 - 18.5) / 30) * 100}%` }} />
              <div className="absolute inset-y-0 bg-amber-500/40" style={{ left: `${((25 - 10) / 30) * 100}%`, width: `${((30 - 25) / 30) * 100}%` }} />
              <div className="absolute inset-y-0 bg-destructive/50" style={{ left: `${((30 - 10) / 30) * 100}%`, right: 0 }} />
              {markerPct !== null && (
                <div className="absolute top-0 h-3 w-0.5 bg-foreground" style={{ left: `calc(${markerPct}% - 1px)` }} />
              )}
            </div>
            <div className="mt-2 grid grid-cols-4 text-[10px] uppercase tracking-wide text-muted-foreground">
              <span>Under &lt;18.5</span>
              <span className="text-center">Normal 18.5–24.9</span>
              <span className="text-center">Over 25–29.9</span>
              <span className="text-right">Obese ≥30</span>
            </div>
          </div>

          {/* BMI reference table */}
          <div className="mt-4 overflow-hidden rounded-xl border border-border">
            <table className="w-full text-xs">
              <thead className="bg-secondary/60 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Classification</th>
                  <th className="px-3 py-2 text-left font-medium">BMI Range</th>
                  <th className="px-3 py-2 text-left font-medium">Health Risk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[
                  { label: "Underweight", range: "< 18.5", risk: "Increased risk", cls: "bg-amber-500/15 text-amber-800 dark:text-amber-200" },
                  { label: "Normal", range: "18.5 – 24.9", risk: "Lowest risk", cls: "bg-sage/15 text-sage" },
                  { label: "Overweight", range: "25 – 29.9", risk: "Moderate risk", cls: "bg-amber-500/15 text-amber-800 dark:text-amber-200" },
                  { label: "Obese", range: "≥ 30", risk: "High risk", cls: "bg-destructive/15 text-destructive" },
                ].map((row) => {
                  const isCurrent = cls?.label === row.label;
                  return (
                    <tr key={row.label} className={isCurrent ? "bg-secondary/40 font-semibold" : ""}>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 ${row.cls}`}>{row.label}</span>
                      </td>
                      <td className="px-3 py-2 font-mono">{row.range}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.risk}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="md:col-span-2">
          <Button type="submit" className="rounded-full">Save profile</Button>
        </div>
      </form>
    </section>
  );
}

function VitalsCard({ patientId }: { patientId: string }) {
  const list = useServerFn(listVitals);
  const create = useServerFn(createVital);
  const del = useServerFn(deleteVital);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["vitals", patientId], queryFn: () => list({ data: { patient_id: patientId } }) });

  const [sys, setSys] = useState("");
  const [dia, setDia] = useState("");
  const [sugar, setSugar] = useState("");
  const [pain, setPain] = useState("");
  const [note, setNote] = useState("");

  const m = useMutation({
    mutationFn: () => create({ data: {
      patient_id: patientId,
      systolic: sys ? parseInt(sys, 10) : null,
      diastolic: dia ? parseInt(dia, 10) : null,
      blood_sugar: sugar ? parseFloat(sugar) : null,
      pain_scale: pain ? parseInt(pain, 10) : null,
      note: note || null,
    } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vitals", patientId] });
      setSys(""); setDia(""); setSugar(""); setPain(""); setNote("");
      toast.success("Logged");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mDel = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vitals", patientId] }),
  });

  return (
    <section className="rounded-3xl border border-border bg-card p-6">
      <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
        <Activity className="h-5 w-5 text-sage" /> Vitals & symptoms
      </h2>
      <form
        className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5"
        onSubmit={(e) => { e.preventDefault(); m.mutate(); }}
      >
        <div>
          <Label className="text-xs">Systolic</Label>
          <Input type="number" placeholder="120" value={sys} onChange={(e) => setSys(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Diastolic</Label>
          <Input type="number" placeholder="80" value={dia} onChange={(e) => setDia(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Blood sugar</Label>
          <Input type="number" placeholder="mg/dL" value={sugar} onChange={(e) => setSugar(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Pain (0-10)</Label>
          <Input type="number" min={0} max={10} value={pain} onChange={(e) => setPain(e.target.value)} />
        </div>
        <div className="col-span-2 md:col-span-1 flex items-end">
          <Button type="submit" className="w-full rounded-full" disabled={m.isPending}>Log</Button>
        </div>
        <div className="col-span-2 md:col-span-5">
          <Input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </form>

      <ul className="mt-4 space-y-2">
        {(q.data ?? []).map((v) => (
          <li key={v.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-secondary/30 p-3 text-sm">
            <div className="flex flex-wrap gap-3">
              <span className="text-xs text-muted-foreground">{formatDateTime(v.recorded_at)}</span>
              {v.systolic && v.diastolic && <span>BP {v.systolic}/{v.diastolic}</span>}
              {v.blood_sugar !== null && <span>Sugar {v.blood_sugar}</span>}
              {v.pain_scale !== null && <span>Pain {v.pain_scale}/10</span>}
              {v.note && <span className="text-muted-foreground">· {v.note}</span>}
            </div>
            <button onClick={() => mDel.mutate(v.id)} className="rounded-full p-1.5 hover:bg-destructive/10">
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </li>
        ))}
        {(q.data ?? []).length === 0 && (
          <li className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            No vitals logged yet.
          </li>
        )}
      </ul>
    </section>
  );
}
