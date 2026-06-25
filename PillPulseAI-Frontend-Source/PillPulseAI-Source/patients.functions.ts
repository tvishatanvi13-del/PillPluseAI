import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listPatients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("patients").select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data ?? [];
  });

const genderEnum = z.enum(["male", "female", "other"]).nullable().optional();

const patientShape = {
  full_name: z.string().min(1).max(200),
  dob: z.string().optional().nullable(),
  gender: genderEnum,
  height_cm: z.number().min(20).max(280).optional().nullable(),
  weight_kg: z.number().min(1).max(500).optional().nullable(),
  allergies: z.array(z.string().min(1).max(120)).max(50).optional(),
  notes: z.string().max(2000).optional().nullable(),
  medical_history: z.string().max(4000).optional().nullable(),
  emergency_contact_name: z.string().max(200).optional().nullable(),
  emergency_contact_phone: z.string().max(40).optional().nullable(),
  emergency_contact_email: z.string().email().max(255).optional().nullable().or(z.literal("").transform(() => null)),
};

export const createPatient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object(patientShape).parse(d))
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase
      .from("patients").insert({
        user_id: context.userId,
        full_name: data.full_name,
        dob: data.dob ?? null,
        gender: data.gender ?? null,
        height_cm: data.height_cm ?? null,
        weight_kg: data.weight_kg ?? null,
        allergies: data.allergies ?? [],
        notes: data.notes ?? null,
        medical_history: data.medical_history ?? null,
        emergency_contact_name: data.emergency_contact_name ?? null,
        emergency_contact_phone: data.emergency_contact_phone ?? null,
        emergency_contact_email: data.emergency_contact_email ?? null,
      }).select("*").single();
    if (error) throw error;
    return row;
  });

export const updatePatient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      patch: z.object({
        full_name: z.string().min(1).max(200).optional(),
        dob: z.string().nullable().optional(),
        gender: genderEnum,
        height_cm: z.number().min(20).max(280).nullable().optional(),
        weight_kg: z.number().min(1).max(500).nullable().optional(),
        allergies: z.array(z.string().min(1).max(120)).max(50).optional(),
        notes: z.string().max(2000).nullable().optional(),
        medical_history: z.string().max(4000).nullable().optional(),
        emergency_contact_name: z.string().max(200).nullable().optional(),
        emergency_contact_phone: z.string().max(40).nullable().optional(),
        emergency_contact_email: z.string().max(255).nullable().optional(),
      }),
    }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("patients").update(data.patch)
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

export const deletePatient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("patients").delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });
