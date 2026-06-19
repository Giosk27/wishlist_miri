const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
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
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!serviceRoleKey || !supabaseUrl) {
    return jsonResponse({ error: 'Missing server secrets' }, 500);
  }

  let payload: {
    endpoint?: string;
    keys?: { auth?: string; p256dh?: string };
    expirationTime?: number | null;
  };

  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (!payload.endpoint) {
    return jsonResponse({ error: 'Missing endpoint' }, 400);
  }

  if (req.method === 'DELETE') {
    const deleteResponse = await supabaseFetch(`/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(payload.endpoint)}`, serviceRoleKey, {
      method: 'DELETE',
    });
    if (!deleteResponse.ok) {
      const details = await deleteResponse.text();
      return jsonResponse({ error: `Delete failed: ${deleteResponse.status} ${details}` }, 500);
    }
    return jsonResponse({ ok: true });
  }

  if (!payload.keys?.auth || !payload.keys?.p256dh) {
    return jsonResponse({ error: 'Missing subscription keys' }, 400);
  }

  await supabaseFetch(`/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(payload.endpoint)}`, serviceRoleKey, {
    method: 'DELETE',
  });

  const insertResponse = await supabaseFetch('/rest/v1/push_subscriptions', serviceRoleKey, {
    method: 'POST',
    body: JSON.stringify({
      endpoint: payload.endpoint,
      auth: payload.keys.auth,
      p256dh: payload.keys.p256dh,
      expiration_time: payload.expirationTime ? new Date(payload.expirationTime).toISOString() : null,
      updated_at: new Date().toISOString(),
    }),
  });

  if (!insertResponse.ok) {
    const details = await insertResponse.text();
    return jsonResponse({ error: `Save failed: ${insertResponse.status} ${details}` }, 500);
  }

  return jsonResponse({ ok: true });
});
