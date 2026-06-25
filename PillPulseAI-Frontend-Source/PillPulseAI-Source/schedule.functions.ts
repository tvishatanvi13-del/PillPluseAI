import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const categoryEnum = z.enum(["medication", "dose", "appointment", "expiry"]);

const frequencySchema = z.object({
  kind: z.enum(["daily", "interval", "custom", "prn", "once", "weekly"]),
  times: z.array(z.string().regex(/^\d{2}:\d{2}$/)).optional(),
  intervalHours: z.number().min(1).max(168).optional(),
  intervalUnit: z.enum(["hour", "day", "week"]).optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  perWeek: z.number().int().min(1).max(50).optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  effective_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  intake: z.enum(["before_food", "with_food", "after_food"]).optional(),
}).nullable().optional();

export const listEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // STRICT user isolation: only fetch rows owned by the signed-in user.
    const { data, error } = await context.supabase
      .from("schedule_events")
      .select("*")
      .eq("user_id", context.userId)
      .order("scheduled_at", { ascending: true });
    if (error) throw error;
    return data ?? [];
  });

export const createEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      title: z.string().min(1).max(200),
      notes: z.string().max(2000).optional().nullable(),
      category: categoryEnum,
      scheduled_at: z.string(),
      expires_at: z.string().optional().nullable(),
      patient_id: z.string().uuid().optional().nullable(),
      dosage: z.string().max(120).optional().nullable(),
      frequency: frequencySchema,
      prn: z.boolean().optional(),
      stock_total: z.number().int().min(0).max(100000).optional().nullable(),
      stock_remaining: z.number().int().min(0).max(100000).optional().nullable(),
      refill_threshold: z.number().int().min(0).max(10000).optional(),
      hospital: z.string().max(200).optional().nullable(),
      hospital_address: z.string().max(500).optional().nullable(),
      doctor: z.string().max(200).optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase
      .from("schedule_events")
      .insert({
        user_id: context.userId,
        title: data.title,
        notes: data.notes ?? null,
        category: data.category,
        scheduled_at: data.scheduled_at,
        expires_at: data.expires_at ?? null,
        patient_id: data.patient_id ?? null,
        dosage: data.dosage ?? null,
        frequency: data.frequency ?? null,
        prn: data.prn ?? false,
        stock_total: data.stock_total ?? null,
        stock_remaining: data.stock_remaining ?? data.stock_total ?? null,
        refill_threshold: data.refill_threshold ?? 5,
        hospital: data.hospital ?? null,
        hospital_address: data.hospital_address ?? null,
        doctor: data.doctor ?? null,
      })
      .select("*").single();
    if (error) throw error;
    return row;
  });

export const updateEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      patch: z.object({
        title: z.string().min(1).max(200).optional(),
        notes: z.string().max(2000).optional().nullable(),
        scheduled_at: z.string().optional(),
        expires_at: z.string().optional().nullable(),
        dosage: z.string().max(120).optional().nullable(),
        frequency: frequencySchema,
        prn: z.boolean().optional(),
        stock_total: z.number().int().min(0).max(100000).optional().nullable(),
        stock_remaining: z.number().int().min(0).max(100000).optional().nullable(),
        refill_threshold: z.number().int().min(0).max(10000).optional(),
        patient_id: z.string().uuid().nullable().optional(),
        hospital: z.string().max(200).optional().nullable(),
        hospital_address: z.string().max(500).optional().nullable(),
        doctor: z.string().max(200).optional().nullable(),
      }),
    }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("schedule_events").update(data.patch).eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const toggleEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), completed: z.boolean() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("schedule_events").update({ completed: data.completed }).eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const deleteEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("schedule_events").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

// ============== Dose log ==============

export const listDoseLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const { data, error } = await context.supabase
      .from("dose_log")
      .select("*")
      .gte("taken_at", since.toISOString())
      .order("taken_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const logDose = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      event_id: z.string().uuid(),
      slot_key: z.string().max(60).optional().nullable(),
      source: z.enum(["timeline", "prn"]).default("timeline"),
    }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("dose_log").insert({
      user_id: context.userId,
      event_id: data.event_id,
      slot_key: data.slot_key ?? null,
      source: data.source,
    });
    if (error) throw error;
    return { ok: true };
  });

export const unlogDose = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      event_id: z.string().uuid(),
      slot_key: z.string().max(60).optional().nullable(),
    }).parse(d))
  .handler(async ({ context, data }) => {
    let q = context.supabase.from("dose_log").delete().eq("event_id", data.event_id);
    if (data.slot_key) q = q.eq("slot_key", data.slot_key);
    const { error } = await q;
    if (error) throw error;
    return { ok: true };
  });

// ============== Medication logs (heatmap) ==============

export const listMedicationLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      patient_id: z.string().uuid().nullable().optional(),
      since: z.string(),
      until: z.string(),
    }).parse(d))
  .handler(async ({ context, data }) => {
    let q = context.supabase
      .from("medication_logs")
      .select("id, medication_id, patient_id, created_at")
      .gte("created_at", data.since)
      .lte("created_at", data.until);
    if (data.patient_id) q = q.eq("patient_id", data.patient_id);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });
