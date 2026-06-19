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

function getExtension(file: File): string {
  const fromName = file.name.split('.').pop()?.trim().toLowerCase();
  if (fromName) return fromName;

  const mimeType = file.type.toLowerCase();
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('gif')) return 'gif';
  return 'jpg';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const adminSecret = Deno.env.get('ADMIN_JWT_SECRET') ?? Deno.env.get('SUPABASE_ADMIN_JWT_SECRET');
  const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!adminSecret || !serviceRoleKey || !supabaseUrl) {
    return jsonResponse({ error: 'Missing server secrets' }, 500);
  }

  const authHeader = req.headers.get('x-admin-token');
  if (!authHeader || !(await verifyAdminToken(authHeader, adminSecret))) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return jsonResponse({ error: 'Invalid form data' }, 400);
  }

  const fileEntry = formData.get('file');
  if (!(fileEntry instanceof File)) {
    return jsonResponse({ error: 'Missing file' }, 400);
  }

  const bucket = 'product-images';
  const fileName = `${crypto.randomUUID()}.${getExtension(fileEntry)}`;
  const uploadUrl = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${bucket}/${encodeURIComponent(fileName)}`;

  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': fileEntry.type || 'application/octet-stream',
      'x-upsert': 'false',
    },
    body: await fileEntry.arrayBuffer(),
  });

  if (!uploadResponse.ok) {
    const details = await uploadResponse.text();
    return jsonResponse({ error: `Upload failed: ${uploadResponse.status} ${details}` }, uploadResponse.status);
  }

  return jsonResponse({
    imageUrl: `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${bucket}/${fileName}`,
  });
});
