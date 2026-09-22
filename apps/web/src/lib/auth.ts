import type { AuthError } from "@supabase/supabase-js";
import { supabase } from "./supabase";

const messages: Record<string, string> = {
  invalid_credentials: "Email ou password incorretos.",
  same_password: "A nova password tem de ser diferente da atual.",
  weak_password: "A password é demasiado fraca (mínimo 6 caracteres).",
  email_exists: "Esse email já está a ser usado.",
  email_address_invalid: "Email inválido.",
  over_request_rate_limit: "Demasiadas tentativas. Espera um pouco.",
};

export function authMessage(error: AuthError): string {
  return (error.code && messages[error.code]) || error.message;
}

/** Re-checks the current password before a sensitive change (no email confirmations are sent). */
export async function verifyPassword(email: string, password: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (!error) return null;
  return error.code === "invalid_credentials" ? "A password atual está incorreta." : authMessage(error);
}
