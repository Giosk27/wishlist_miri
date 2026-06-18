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
  'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
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
  if (req.method !== 'GET' && req.method !== 'DELETE') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

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

  if (req.method === 'GET') {
    const [membersResponse, groupsResponse, productsResponse] = await Promise.all([
      supabaseFetch('/rest/v1/members?select=id,group_id,name,email,status,created_at', serviceRoleKey),
      supabaseFetch('/rest/v1/gift_groups?select=id,product_id', serviceRoleKey),
      supabaseFetch('/rest/v1/products?select=id,name', serviceRoleKey),
    ]);

    if (!membersResponse.ok) {
      return jsonResponse({ error: `Failed to load members: ${membersResponse.status}` }, 500);
    }
    if (!groupsResponse.ok) {
      return jsonResponse({ error: `Failed to load groups: ${groupsResponse.status}` }, 500);
    }
    if (!productsResponse.ok) {
      return jsonResponse({ error: `Failed to load products: ${productsResponse.status}` }, 500);
    }

    const members = await membersResponse.json() as Array<{
      id: string;
      group_id: string;
      name: string;
      email: string;
      status: string;
      created_at: string;
    }>;
    const groups = await groupsResponse.json() as Array<{ id: string; product_id: string }>;
    const products = await productsResponse.json() as Array<{ id: string; name: string }>;

    const groupMap = new Map(groups.map((group) => [group.id, group]));
    const productMap = new Map(products.map((product) => [product.id, product]));

    return jsonResponse({
      members: members.map((member) => {
        const group = groupMap.get(member.group_id);
        const product = group ? productMap.get(group.product_id) : null;
        return {
          ...member,
          product_id: group?.product_id ?? null,
          product_name: product?.name ?? '',
        };
      }),
    });
  }

  let payload: { memberIds?: string[] };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const memberIds = (payload.memberIds ?? []).filter(Boolean);
  if (memberIds.length === 0) {
    return jsonResponse({ error: 'Missing memberIds' }, 400);
  }

  for (const memberId of memberIds) {
    const memberResponse = await supabaseFetch(`/rest/v1/members?select=id,group_id&id=eq.${memberId}`, serviceRoleKey);
    if (!memberResponse.ok) {
      return jsonResponse({ error: `Failed to load member ${memberId}: ${memberResponse.status}` }, 500);
    }
    const memberRows = await memberResponse.json() as Array<{ id: string; group_id: string }>;
    const member = memberRows[0];
    if (!member) continue;

    await supabaseFetch(`/rest/v1/members?id=eq.${memberId}`, serviceRoleKey, { method: 'DELETE' });

    const remainingResponse = await supabaseFetch(`/rest/v1/members?select=id&group_id=eq.${member.group_id}`, serviceRoleKey);
    if (!remainingResponse.ok) {
      return jsonResponse({ error: `Failed to check remaining members: ${remainingResponse.status}` }, 500);
    }
    const remaining = await remainingResponse.json() as Array<{ id: string }>;
    if (remaining.length === 0) {
      await supabaseFetch(`/rest/v1/gift_groups?id=eq.${member.group_id}`, serviceRoleKey, { method: 'DELETE' });
    }
  }

  return jsonResponse({ ok: true, deleted: memberIds.length });
});
