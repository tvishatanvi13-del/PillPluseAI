import { createFileRoute, Outlet, useNavigate, Link, useParams } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listThreads, createThread, deleteThread } from "@/lib/threads.functions";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, MessageCircleHeart } from "lucide-react";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({ meta: [{ title: "AI Health Assistant — PillPulse AI" }] }),
  component: ChatLayout,
});

function ChatLayout() {
  const list = useServerFn(listThreads);
  const create = useServerFn(createThread);
  const remove = useServerFn(deleteThread);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { threadId?: string };

  const threadsQ = useQuery({ queryKey: ["threads"], queryFn: () => list() });

  const newThread = useMutation({
    mutationFn: () => create(),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ["threads"] });
      navigate({ to: "/chat/$threadId", params: { threadId: t.id } });
    },
  });

  const del = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["threads"] });
      if (params.threadId === id) navigate({ to: "/chat" });
    },
  });

  // Auto-create or pick first thread when visiting /chat
  useEffect(() => {
    if (!threadsQ.data || params.threadId) return;
    if (threadsQ.data.length > 0) {
      navigate({ to: "/chat/$threadId", params: { threadId: threadsQ.data[0].id }, replace: true });
    } else if (!newThread.isPending) {
      newThread.mutate();
    }
  }, [threadsQ.data, params.threadId, navigate, newThread]);

  return (
    <main className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-6 py-8 md:grid-cols-[260px_1fr]">
      <aside className="rounded-2xl border border-border bg-card p-3">
        <Button
          onClick={() => newThread.mutate()}
          disabled={newThread.isPending}
          className="w-full rounded-full"
        >
          <Plus className="mr-1 h-4 w-4" /> New chat
        </Button>
        <div className="mt-3 space-y-1">
          {threadsQ.data?.map((t) => {
            const active = params.threadId === t.id;
            return (
              <div
                key={t.id}
                className={`group flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition ${
                  active ? "bg-secondary" : "hover:bg-secondary/60"
                }`}
              >
                <Link
                  to="/chat/$threadId"
                  params={{ threadId: t.id }}
                  className="flex flex-1 items-center gap-2 truncate text-left"
                >
                  <MessageCircleHeart className="h-4 w-4 text-sage" />
                  <span className="truncate">{t.title}</span>
                </Link>
                <button
                  onClick={(e) => { e.stopPropagation(); del.mutate(t.id); }}
                  className="opacity-0 transition group-hover:opacity-100"
                  aria-label="Delete conversation"
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            );
          })}
          {threadsQ.data?.length === 0 && (
            <p className="px-2 py-4 text-xs text-muted-foreground">No conversations yet.</p>
          )}
        </div>
      </aside>
      <section className="min-h-[70vh] rounded-2xl border border-border bg-card">
        <Outlet />
      </section>
    </main>
  );
}
