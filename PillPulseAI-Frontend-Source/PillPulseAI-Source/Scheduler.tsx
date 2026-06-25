import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { createEvent } from "@/lib/schedule.functions";
import { listPatients } from "@/lib/patients.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, CalendarPlus } from "lucide-react";
import { ScannerDialog } from "@/components/ScannerDialog";
import { MedicationForm } from "@/components/MedicationForm";

const categories = [
  { v: "medication", label: "Medication" },
  { v: "appointment", label: "Appointment" },
] as const;

type Category = (typeof categories)[number]["v"];

function localToISO(local: string) {
  if (!local) return new Date().toISOString();
  // datetime-local is interpreted as local time by Date constructor → correct UTC ISO.
  return new Date(local).toISOString();
}

export function Scheduler() {
  const [category, setCategory] = useState<Category>("medication");

  return (
    <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
            <CalendarPlus className="h-5 w-5 text-[color:var(--color-sage)]" /> Add to schedule
          </h2>
          <p className="text-sm text-muted-foreground">A medication or doctor's appointment.</p>
        </div>
        <ScannerDialog />
      </div>

      <div className="mt-5">
        <Label>Category</Label>
        <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
          <SelectTrigger className="md:w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            {categories.map((c) => (<SelectItem key={c.v} value={c.v}>{c.label}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>

      {category === "medication" ? (
        <div className="mt-5"><MedicationForm /></div>
      ) : (
        <div className="mt-5"><AppointmentForm onSaved={() => setCategory("medication")} /></div>
      )}
    </section>
  );
}

function AppointmentForm({ onSaved }: { onSaved?: () => void }) {
  const create = useServerFn(createEvent);
  const listP = useServerFn(listPatients);
  const qc = useQueryClient();
  const patientsQ = useQuery({ queryKey: ["patients"], queryFn: () => listP() });

  const [patientId, setPatientId] = useState<string>("");
  const [doctor, setDoctor] = useState("");
  const [hospital, setHospital] = useState("");
  const [address, setAddress] = useState("");
  const [when, setWhen] = useState("");
  const [notes, setNotes] = useState("");

  const m = useMutation({
    mutationFn: create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      toast.success("Appointment scheduled");
      setDoctor(""); setHospital(""); setAddress(""); setWhen(""); setNotes(""); setPatientId("");
      onSaved?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      className="grid grid-cols-1 gap-3 md:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!doctor.trim() || !when) return toast.error("Doctor name and date are required");
        m.mutate({
          data: {
            title: `${doctor.trim()}${hospital ? ` · ${hospital.trim()}` : ""}`,
            category: "appointment",
            scheduled_at: localToISO(when),
            notes: notes.trim() || null,
            patient_id: patientId || null,
            doctor: doctor.trim(),
            hospital: hospital.trim() || null,
            hospital_address: address.trim() || null,
          },
        });
      }}
    >
      <div>
        <Label>Patient</Label>
        <Select value={patientId || "none"} onValueChange={(v) => setPatientId(v === "none" ? "" : v)}>
          <SelectTrigger><SelectValue placeholder="Select patient" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Unassigned</SelectItem>
            {(patientsQ.data ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="ap-when">Date & time</Label>
        <Input id="ap-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="ap-doc">Doctor's name</Label>
        <Input id="ap-doc" value={doctor} onChange={(e) => setDoctor(e.target.value)} placeholder="Dr. Lee" />
      </div>
      <div>
        <Label htmlFor="ap-hos">Hospital / clinic</Label>
        <Input id="ap-hos" value={hospital} onChange={(e) => setHospital(e.target.value)} placeholder="Mercy Hospital" />
      </div>
      <div className="md:col-span-2">
        <Label htmlFor="ap-addr">Address (optional)</Label>
        <Input id="ap-addr" value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <div className="md:col-span-2">
        <Label htmlFor="ap-notes">Notes (optional)</Label>
        <Textarea id="ap-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="md:col-span-2">
        <Button type="submit" disabled={m.isPending} className="rounded-full">
          <Plus className="mr-1 h-4 w-4" /> {m.isPending ? "Scheduling…" : "Schedule appointment"}
        </Button>
      </div>
    </form>
  );
}
