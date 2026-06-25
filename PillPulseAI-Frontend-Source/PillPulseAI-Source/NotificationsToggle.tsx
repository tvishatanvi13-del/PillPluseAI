import { Bell, BellOff, BellRing } from "lucide-react";
import { usePushReminders } from "@/hooks/use-push-reminders";

export function NotificationsToggle() {
  const { permission, enabled, enable, disable } = usePushReminders();

  if (permission === "unsupported") {
    return (
      <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
        <BellOff className="h-3.5 w-3.5" /> Notifications not supported here
      </div>
    );
  }

  if (permission === "denied") {
    return (
      <div className="flex items-center gap-2 rounded-full border border-destructive/40 bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
        <BellOff className="h-3.5 w-3.5" /> Notifications blocked — allow them in browser settings
      </div>
    );
  }

  if (enabled && permission === "granted") {
    return (
      <button
        onClick={disable}
        className="inline-flex items-center gap-2 rounded-full border border-sage/40 bg-sage/10 px-3 py-1.5 text-xs font-medium text-sage hover:bg-sage/20"
      >
        <BellRing className="h-3.5 w-3.5" /> Reminders on — pause
      </button>
    );
  }

  return (
    <button
      onClick={enable}
      className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-secondary"
    >
      <Bell className="h-3.5 w-3.5" /> Enable reminders
    </button>
  );
}
