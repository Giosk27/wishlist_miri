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

function getAdminSecret(): string | null {
  return Deno.env.get('ADMIN_JWT_SECRET') ?? Deno.env.get('SUPABASE_ADMIN_JWT_SECRET');
}

function getServiceRoleKey(): string | null {
  return Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
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

type ProductInput = {
  name?: string;
  price?: number;
  image_url?: string;
  description?: string | null;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const adminSecret = getAdminSecret();
  const serviceRoleKey = getServiceRoleKey();
  if (!adminSecret || !serviceRoleKey) {
    return jsonResponse({ error: 'Missing server secrets' }, 500);
  }

  const authHeader = req.headers.get('x-admin-token');
  if (!authHeader || !(await verifyAdminToken(authHeader, adminSecret))) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let payload: { action?: 'upsert' | 'delete'; id?: string; product?: ProductInput };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (payload.action === 'delete') {
    if (!payload.id) return jsonResponse({ error: 'Missing id' }, 400);
    const deleteResponse = await supabaseFetch(`/rest/v1/products?id=eq.${encodeURIComponent(payload.id)}`, serviceRoleKey, {
      method: 'DELETE',
    });
    if (!deleteResponse.ok) {
      const details = await deleteResponse.text();
      return jsonResponse({ error: `Delete failed: ${deleteResponse.status} ${details}` }, deleteResponse.status);
    }
    return jsonResponse({ ok: true });
  }

  const product = payload.product;
  if (!product?.name || typeof product.price !== 'number' || !product.image_url) {
    return jsonResponse({ error: 'Missing product fields' }, 400);
  }

  const cleanProduct = {
    name: product.name,
    price: product.price,
    image_url: product.image_url,
    description: product.description ?? null,
  };

  const response = payload.id
    ? await supabaseFetch(`/rest/v1/products?id=eq.${encodeURIComponent(payload.id)}`, serviceRoleKey, {
      method: 'PATCH',
      headers: {
        Prefer: 'return=representation',
      },
      body: JSON.stringify(cleanProduct),
    })
    : await supabaseFetch('/rest/v1/products', serviceRoleKey, {
      method: 'POST',
      headers: {
        Prefer: 'return=representation',
      },
      body: JSON.stringify(cleanProduct),
    });

  if (!response.ok) {
    const details = await response.text();
    return jsonResponse({ error: `Save failed: ${response.status} ${details}` }, response.status);
  }

  const data = await response.json() as Array<{ id: string; name: string; price: number; image_url: string; description: string | null; created_at: string }>;
  return jsonResponse({ product: data[0] ?? null });
});
