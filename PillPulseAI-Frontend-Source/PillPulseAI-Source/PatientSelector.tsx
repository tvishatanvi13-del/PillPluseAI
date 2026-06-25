import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPatients } from "@/lib/patients.functions";
import { useActivePatient } from "@/lib/active-patient";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { User } from "lucide-react";

export function PatientSelector() {
  const list = useServerFn(listPatients);
  const { activePatientId, setActivePatientId } = useActivePatient();
  const q = useQuery({ queryKey: ["patients"], queryFn: () => list() });

  return (
    <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
      <User className="h-3.5 w-3.5 text-muted-foreground" />
      <Select value={activePatientId ?? "all"} onValueChange={(v) => setActivePatientId(v === "all" ? null : v)}>
        <SelectTrigger className="h-auto border-0 bg-transparent p-0 text-xs shadow-none focus:ring-0">
          <SelectValue placeholder="All patients" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All patients</SelectItem>
          {(q.data ?? []).map((p) => (
            <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
