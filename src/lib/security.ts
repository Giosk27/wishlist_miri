/**
 * Utility di sicurezza per proteggere dati sensibili lato client.
 * Le email non vengono mai esposte nelle view pubbliche.
 */

export async function hashEmail(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const hashBuffer = await subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback per browser vecchi o contesti dove Web Crypto non è disponibile.
  let hash = 2166136261;
  for (const byte of data) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return (`0000000${(hash >>> 0).toString(16)}`).slice(-8);
}

export function generateToken(): string {
  const array = new Uint8Array(32);
  const randomSource = globalThis.crypto?.getRandomValues;
  if (randomSource) {
    randomSource.call(globalThis.crypto, array);
  } else {
    for (let index = 0; index < array.length; index += 1) {
      array[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function sanitizePublicName(name: string): string {
  return name.trim().slice(0, 50);
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function toPublicMember(member: { id: string; name: string; status: string }) {
  return {
    id: member.id,
    name: member.name,
    status: member.status as 'pending' | 'approved',
  };
}

export function calculatePricePerPerson(price: number, approvedCount: number): number | null {
  if (approvedCount <= 0) return null;
  return Math.round((price / approvedCount) * 100) / 100;
}

const SESSION_KEY = 'wishlist_member_session';
const ADMIN_KEY = 'wishlist_admin_session';

export function saveMemberSession(session: {
  memberId: string;
  groupId: string;
  name: string;
  email: string;
  sessionToken: string;
}): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function getMemberSession(): {
  memberId: string;
  groupId: string;
  name: string;
  email: string;
  sessionToken: string;
} | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearMemberSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

export function setAdminSession(token: string | null): void {
  if (token) {
    sessionStorage.setItem(ADMIN_KEY, token);
  } else {
    sessionStorage.removeItem(ADMIN_KEY);
  }
}

export function getAdminSessionToken(): string | null {
  return sessionStorage.getItem(ADMIN_KEY);
}

export function isAdminAuthenticated(): boolean {
  return !!sessionStorage.getItem(ADMIN_KEY);
}

export async function verifyAdminPassword(password: string): Promise<string | null> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseAnonKey) {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/admin-auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        'x-client-info': 'wishlist-site',
      },
      body: JSON.stringify({ password }),
    });
    if (!response.ok) return null;
    const data = await response.json() as { token?: string };
    return data.token ?? null;
  }

  const expected = import.meta.env.VITE_ADMIN_PASSWORD;
  if (!expected) return null;
  return password === expected ? generateToken() : null;
}
