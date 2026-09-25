"use server";

import { createClient } from "@/lib/supabase/server";

export type LoginState = { error?: string; sent?: boolean };

export async function signIn(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter an email address." };

  // Present when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set (components/turnstile.tsx).
  // Supabase checks it only once captcha is switched on in the project's Auth
  // settings, and ignores it until then, so the code can ship first.
  const captchaToken = String(formData.get("captchaToken") ?? "") || undefined;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: captchaToken ? { captchaToken } : undefined,
  });

  if (error) {
    // Supabase's wording ("captcha protected: request disallowed (...)")
    // means nothing to a person.
    if (/captcha/i.test(error.message)) {
      return { error: "We couldn't confirm you're not a bot. Try again." };
    }
    return { error: error.message };
  }
  return { sent: true };
}
