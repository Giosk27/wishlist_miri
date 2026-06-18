import { supabase, isSupabaseConfigured } from './supabase';

export interface AuthUser {
  id: string;
  email: string | null;
}

export async function getCurrentAuthUser(): Promise<AuthUser | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return null;
  return { id: user.id, email: user.email ?? null };
}

export async function getCurrentAuthAccessToken(): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function signInWithPassword(email: string, password: string): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) return null;
  return data.session.access_token;
}

export async function signUpWithPassword(email: string, password: string): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error || !data.session) return null;
  return data.session.access_token;
}

export async function signOut(): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  await supabase.auth.signOut();
}
