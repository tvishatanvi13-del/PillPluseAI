import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, ScanLine, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { MedicationForm, type MedicationPrefill } from "@/components/MedicationForm";

export function ScannerDialog() {
  const [open, setOpen] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [prefill, setPrefill] = useState<MedicationPrefill | null>(null);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!open) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStreaming(false);
      setPrefill(null);
      return;
    }
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        streamRef.current = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          await videoRef.current.play();
          setStreaming(true);
        }
      } catch (e) {
        toast.error("Couldn't access camera: " + (e as Error).message);
      }
    })();
  }, [open]);

  const scan = async () => {
    if (!videoRef.current) return;
    setBusy(true);
    try {
      const v = videoRef.current;
      const canvas = document.createElement("canvas");
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      canvas.getContext("2d")!.drawImage(v, 0, 0);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);

      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ image: dataUrl }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as {
        text: string;
        parsed: null | {
          name?: string; dosage?: string; expiration?: string;
          instructions?: string; warnings?: string; is_medication?: boolean;
        };
      };
      if (!json.parsed || json.parsed.is_medication === false) {
        toast.error(json.text || "Couldn't read label. Try again with better lighting.");
        return;
      }
      // Stop camera once we have parsed data
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStreaming(false);
      setPrefill({
        name: json.parsed.name ?? "",
        dosage: json.parsed.dosage ?? "",
        expiration: json.parsed.expiration ?? "",
        instructions: json.parsed.instructions ?? "",
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="rounded-full">
          <Camera className="mr-1.5 h-4 w-4" /> Scan label
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">{prefill ? "Review medication" : "AI Vision Scanner"}</DialogTitle>
        </DialogHeader>

        {!prefill && (
          <>
            <div className="overflow-hidden rounded-2xl bg-black">
              <video ref={videoRef} className="aspect-video w-full object-cover" muted playsInline />
            </div>
            <div className="flex gap-2">
              <Button onClick={scan} disabled={!streaming || busy} className="flex-1 rounded-full">
                {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ScanLine className="mr-1 h-4 w-4" />}
                {busy ? "Reading label…" : "Scan Bottle / Pill"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Hold the label steady and well-lit. Review the AI's reading before saving.
            </p>
          </>
        )}

        {prefill && (
          <MedicationForm prefill={prefill} onSaved={() => setOpen(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}
