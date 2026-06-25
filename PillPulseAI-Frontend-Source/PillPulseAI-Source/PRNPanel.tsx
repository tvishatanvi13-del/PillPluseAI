import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listEvents, logDose } from "@/lib/schedule.functions";
import { useActivePatient } from "@/lib/active-patient";
import { Pill, Zap, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function PRNPanel() {
  const list = useServerFn(listEvents);
  const logFn = useServerFn(logDose);
  const qc = useQueryClient();
  const { activePatientId } = useActivePatient();

  const q = useQuery({ queryKey: ["events"], queryFn: () => list() });

  const prnMeds = useMemo(() => {
    return (q.data ?? []).filter((e) => e.prn && e.category === "medication")
      .filter((e) => !activePatientId || e.patient_id === activePatientId);
  }, [q.data, activePatientId]);

  const m = useMutation({
    mutationFn: (event_id: string) => logFn({ data: { event_id, source: "prn" } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["dose_log_today"] });
      toast.success("Dose logged");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (prnMeds.length === 0) return null;

  return (
    <section className="mt-6 rounded-3xl border border-border bg-secondary/30 p-5">
      <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
        <Zap className="h-4 w-4 text-amber-500" /> As-needed medications
      </h3>
      <p className="text-xs text-muted-foreground">Tap "Log dose" each time you take one.</p>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        {prnMeds.map((e) => {
          const low = e.stock_remaining !== null && e.stock_remaining !== undefined
            && e.stock_remaining <= (e.refill_threshold ?? 5);
          return (
            <div key={e.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <Pill className="h-4 w-4 text-sage" />
                <span className="font-medium">{e.title}</span>
                {low && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                    <AlertTriangle className="h-3 w-3" /> Refill
                  </span>
                )}
              </div>
              {e.dosage && <p className="mt-1 text-xs text-muted-foreground">{e.dosage}</p>}
              {e.stock_remaining !== null && e.stock_remaining !== undefined && (
                <p className="mt-1 text-xs text-muted-foreground">{e.stock_remaining} left</p>
              )}
              <Button
                size="sm"
                className="mt-3 w-full rounded-full"
                disabled={m.isPending}
                onClick={() => m.mutate(e.id)}
              >
                Log dose
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
