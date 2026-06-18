const encoder = new TextEncoder();

function fromBase64Url(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '==='.slice((normalized.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function importSecret(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function verifyAdminToken(token: string, secret: string): Promise<boolean> {
  const [payloadSegment, signatureSegment] = token.split('.');
  if (!payloadSegment || !signatureSegment) return false;

  const key = await importSecret(secret);
  const signatureBytes = fromBase64Url(signatureSegment);
  const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(payloadSegment));
  if (!valid) return false;

  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadSegment))) as { exp?: number };
    return typeof payload.exp === 'number' && payload.exp >= Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-admin-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

async function supabaseFetch(path: string, serviceRoleKey: string, init?: RequestInit): Promise<Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!supabaseUrl) throw new Error('Missing SUPABASE_URL');
  return fetch(`${supabaseUrl.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const adminSecret = Deno.env.get('ADMIN_JWT_SECRET');
  const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!adminSecret || !serviceRoleKey || !supabaseUrl) {
    return jsonResponse({ error: 'Missing server secrets' }, 500);
  }

  const token = req.headers.get('x-admin-token') ?? '';
  if (!token || !(await verifyAdminToken(token, adminSecret))) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let payload: { scope?: 'all' | 'product'; productId?: string | null };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (!payload.scope) {
    return jsonResponse({ error: 'Missing scope' }, 400);
  }
  if (payload.scope === 'product' && !payload.productId) {
    return jsonResponse({ error: 'Missing productId' }, 400);
  }

  const targetPath = payload.scope === 'all'
    ? '/rest/v1/app_notifications'
    : `/rest/v1/app_notifications?target_scope=eq.product&target_product_id=eq.${payload.productId}`;

  const response = await supabaseFetch(targetPath, serviceRoleKey, { method: 'DELETE' });
  if (!response.ok) {
    const details = await response.text();
    return jsonResponse({ error: `Delete failed: ${response.status} ${details}` }, 500);
  }

  return jsonResponse({ ok: true });
});
