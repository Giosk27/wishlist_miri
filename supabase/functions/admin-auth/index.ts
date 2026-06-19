const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
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

async function createAdminToken(secret: string, ttlSeconds = 60 * 60 * 12): Promise<string> {
  const payload = {
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    nonce: crypto.randomUUID(),
  };
  const payloadSegment = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await importSecret(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadSegment));
  return `${payloadSegment}.${toBase64Url(new Uint8Array(signature))}`;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const adminPassword = Deno.env.get('ADMIN_PASSWORD');
  const adminTokenSecret = Deno.env.get('ADMIN_JWT_SECRET') ?? Deno.env.get('SUPABASE_ADMIN_JWT_SECRET');
  if (!adminPassword || !adminTokenSecret) {
    return jsonResponse({ error: 'Missing admin secrets' }, 500);
  }

  let payload: { password?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (payload.password !== adminPassword) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const token = await createAdminToken(adminTokenSecret);
  return jsonResponse({ ok: true, token });
});
