import { createFileRoute } from "@tanstack/react-router";
import { Scheduler } from "@/components/Scheduler";
import { Timeline } from "@/components/Timeline";
import { DailyTimeline } from "@/components/DailyTimeline";
import { PRNPanel } from "@/components/PRNPanel";
import { NotificationsToggle } from "@/components/NotificationsToggle";
import { PatientSelector } from "@/components/PatientSelector";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Your Family Timeline — PillPulse AI" }] }),
  component: Dashboard,
});

function Dashboard() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold">Your family timeline</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Add meds, doses or appointments. Everything stays in sync across your household.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PatientSelector />
          <NotificationsToggle />
        </div>
      </div>
      <PRNPanel />
      <DailyTimeline />
      <div className="mt-8">
        <Scheduler />
      </div>
      <Timeline />
    </main>
  );
}
