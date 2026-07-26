"use server";

import { createClient } from "@/lib/supabase/server";

export type LoginState = { error?: string; sent?: boolean };

export async function signIn(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter an email address." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ email });

  if (error) return { error: error.message };
  return { sent: true };
}
