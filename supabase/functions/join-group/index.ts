const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function hashEmail(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(normalized));
  return Array.from(new Uint8Array(hashBuffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
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

async function getCurrentUser(accessToken: string, serviceRoleKey: string): Promise<{ id: string; email: string | null }> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!supabaseUrl) throw new Error('Missing SUPABASE_URL');

  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Unauthorized`);
  }

  const data = await response.json() as { id?: string; email?: string | null };
  if (!data.id) throw new Error('Unauthorized');
  return { id: data.id, email: data.email ?? null };
}

async function sendMail(serviceRoleKey: string, to: string, subject: string, html: string): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!supabaseUrl) throw new Error('Missing SUPABASE_URL');
  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/send-mail`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'x-client-info': 'wishlist-join-group',
    },
    body: JSON.stringify({ to, subject, html }),
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`send-mail failed: ${response.status} ${details}`);
  }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildGroupUpdateEmailHtml(params: {
  memberName: string;
  productName: string;
  participantNames: string[];
  pricePerPerson: number;
  totalPrice: number;
  myGroupUrl: string;
}): string {
  const participants = params.participantNames.length > 0
    ? params.participantNames.map((name) => `<span style="display:inline-block;margin:0 6px 6px 0;padding:6px 10px;border-radius:999px;background:#f3e8ff;color:#6b21a8;font-size:13px;">${escapeHtml(name)}</span>`).join('')
    : '<span style="color:#7c3aed;">Nessun partecipante ancora</span>';

  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; background:#faf5ff; padding:24px;">
      <div style="max-width:620px; margin:0 auto; background:#ffffff; border:1px solid #e9d5ff; border-radius:20px; overflow:hidden;">
        <div style="background:linear-gradient(135deg,#7c3aed,#c084fc); padding:24px; color:#fff;">
          <div style="font-size:20px; font-weight:700;">Wishlist · Regalo di gruppo</div>
        </div>
        <div style="padding:24px;">
          <h2 style="margin:0 0 12px; font-size:24px; color:#4c1d95;">Ciao ${escapeHtml(params.memberName)}!</h2>
          <p style="margin:0 0 12px; color:#4c1d95;">Il gruppo regalo per <strong>${escapeHtml(params.productName)}</strong> è stato aggiornato.</p>
          <p style="margin:0 0 14px; color:#5b21b6;">Partecipanti attuali</p>
          <div style="margin-bottom:20px;">${participants}</div>
          <div style="background:#f5f3ff; border:1px solid #ddd6fe; border-radius:16px; padding:16px; margin-bottom:16px;">
            <p style="margin:0; font-size:14px; color:#6b21a8;">Nuovo importo a persona</p>
            <p style="margin:6px 0 0; font-size:28px; font-weight:700; color:#4c1d95;">€${params.pricePerPerson.toFixed(2)}</p>
          </div>
          <p style="margin:0 0 18px; color:#6b21a8;">Prezzo totale regalo: <strong>€${params.totalPrice.toFixed(2)}</strong></p>
          <a href="${params.myGroupUrl}" style="display:inline-block; background:#7c3aed; color:#fff; text-decoration:none; padding:12px 18px; border-radius:14px; font-weight:700;">Gestisci il tuo gruppo</a>
          <hr style="border:none; border-top:1px solid #e9d5ff; margin:24px 0;" />
          <p style="margin:0; font-size:12px; color:#7c3aed;">Se non riconosci questa email, puoi ignorarla tranquillamente.</p>
        </div>
      </div>
    </div>
  `;
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

  const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceRoleKey) {
    return jsonResponse({ error: 'Missing SERVICE_ROLE_KEY' }, 500);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';
  if (!accessToken) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const currentUser = await getCurrentUser(accessToken, serviceRoleKey);

  let payload: {
    productId?: string;
    groupId?: string | null;
    name?: string;
    email?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (!payload.productId || !payload.name?.trim()) {
    return jsonResponse({ error: 'Missing productId or name' }, 400);
  }

  const email = (currentUser.email ?? payload.email ?? '').trim().toLowerCase();
  if (!email) {
    return jsonResponse({ error: 'Missing email' }, 400);
  }

  const emailHash = await hashEmail(email);

  const { data: existingMember, error: existingError } = await supabaseFetch(
    `/rest/v1/members?select=id,group_id,auth_user_id,name,email,session_token,status,email_hash&email_hash=eq.${emailHash}`,
    serviceRoleKey,
  ).then(async (response) => {
    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Failed to load existing member: ${response.status} ${details}`);
    }
    const rows = await response.json() as Array<{
      id: string;
      group_id: string;
      auth_user_id: string | null;
      name: string;
      email: string;
      session_token: string;
      status: string;
      email_hash: string;
    }>;
    return { data: rows[0] ?? null, error: null };
  }).catch((error) => ({ data: null, error }));

  if (existingError) {
    return jsonResponse({ error: existingError instanceof Error ? existingError.message : 'Failed to load existing member' }, 500);
  }

  if (existingMember) {
    if (!existingMember.auth_user_id) {
      await supabaseFetch(`/rest/v1/members?id=eq.${existingMember.id}`, serviceRoleKey, {
        method: 'PATCH',
        headers: {
          Prefer: 'return=representation',
        },
        body: JSON.stringify({ auth_user_id: currentUser.id }),
      });
    }

    if (existingMember.auth_user_id !== currentUser.id) {
      return jsonResponse({ error: 'Sei già iscritto a un gruppo. Puoi cambiarlo dalla pagina "Il mio gruppo".' }, 409);
    }

    return jsonResponse({ error: 'Sei già iscritto a un gruppo. Puoi cambiarlo dalla pagina "Il mio gruppo".' }, 409);
  }

  const productResponse = await supabaseFetch(`/rest/v1/products?select=id,name,price,image_url,description,created_at&id=eq.${payload.productId}`, serviceRoleKey);
  if (!productResponse.ok) {
    const details = await productResponse.text();
    return jsonResponse({ error: `Failed to load product: ${productResponse.status} ${details}` }, 500);
  }
  const productRows = await productResponse.json() as Array<{
    id: string;
    name: string;
    price: number;
    image_url: string;
    description: string;
    created_at: string;
  }>;
  const product = productRows[0];
  if (!product) {
    return jsonResponse({ error: 'Prodotto non trovato' }, 404);
  }

  const siteUrl = Deno.env.get('SITE_URL') ?? '';
  let groupId = payload.groupId ?? undefined;
  let isNewGroup = false;

  if (groupId) {
    const groupResponse = await supabaseFetch(`/rest/v1/gift_groups?id=eq.${groupId}&select=id,product_id,purchased,created_at`, serviceRoleKey);
    if (!groupResponse.ok) {
      const details = await groupResponse.text();
      return jsonResponse({ error: `Failed to load group: ${groupResponse.status} ${details}` }, 500);
    }
    const groups = await groupResponse.json() as Array<{ id: string; product_id: string }>;
    const group = groups[0];
    if (!group) return jsonResponse({ error: 'Gruppo non trovato' }, 404);
    if (group.product_id !== payload.productId) {
      return jsonResponse({ error: 'Il gruppo selezionato non appartiene a questo prodotto' }, 400);
    }
  } else {
    const existingGroupResponse = await supabaseFetch(`/rest/v1/gift_groups?select=id,product_id&product_id=eq.${payload.productId}`, serviceRoleKey);
    if (!existingGroupResponse.ok) {
      const details = await existingGroupResponse.text();
      return jsonResponse({ error: `Failed to load group: ${existingGroupResponse.status} ${details}` }, 500);
    }
    const existingGroups = await existingGroupResponse.json() as Array<{ id: string; product_id: string }>;
    if (existingGroups[0]) {
      groupId = existingGroups[0].id;
    } else {
      const newGroupResponse = await supabaseFetch('/rest/v1/gift_groups', serviceRoleKey, {
        method: 'POST',
        headers: {
          Prefer: 'return=representation',
        },
        body: JSON.stringify({ product_id: payload.productId, purchased: false }),
      });
      if (!newGroupResponse.ok) {
        const details = await newGroupResponse.text();
        return jsonResponse({ error: `Failed to create group: ${newGroupResponse.status} ${details}` }, 500);
      }
      const createdGroups = await newGroupResponse.json() as Array<{ id: string }>;
      groupId = createdGroups[0]?.id;
      isNewGroup = true;
    }
  }

  if (!groupId) {
    return jsonResponse({ error: 'Gruppo non disponibile' }, 500);
  }

  const memberPayload = {
    group_id: groupId,
    auth_user_id: currentUser.id,
    name: payload.name.trim().slice(0, 50),
    email,
    email_hash: emailHash,
    status: 'approved',
    approval_token: toBase64Url(crypto.getRandomValues(new Uint8Array(32))),
    session_token: toBase64Url(crypto.getRandomValues(new Uint8Array(32))),
  };

  let memberInsertResponse = await supabaseFetch('/rest/v1/members', serviceRoleKey, {
    method: 'POST',
    headers: {
      Prefer: 'return=representation',
    },
    body: JSON.stringify(memberPayload),
  });

  if (!memberInsertResponse.ok && memberInsertResponse.status === 409 && existingMember) {
    return jsonResponse({ error: 'Sei già iscritto a un gruppo. Puoi cambiarlo dalla pagina "Il mio gruppo".' }, 409);
  }

  if (!memberInsertResponse.ok) {
    const details = await memberInsertResponse.text();
    return jsonResponse({ error: `Failed to create member: ${memberInsertResponse.status} ${details}` }, 500);
  }

  const insertedMembers = await memberInsertResponse.json() as Array<{
    id: string;
    group_id: string;
    auth_user_id: string | null;
    name: string;
    email: string;
    email_hash: string;
    status: string;
    session_token: string;
    created_at: string;
  }>;
  const member = insertedMembers[0];
  if (!member) {
    return jsonResponse({ error: 'Member not created' }, 500);
  }

  const allMembersResponse = await supabaseFetch(`/rest/v1/members?select=id,name,email,status&group_id=eq.${groupId}`, serviceRoleKey);
  if (!allMembersResponse.ok) {
    const details = await allMembersResponse.text();
    return jsonResponse({ error: `Failed to load group members: ${allMembersResponse.status} ${details}` }, 500);
  }
  const allMembers = await allMembersResponse.json() as Array<{ id: string; name: string; email: string; status: string }>;
  const approvedMembers = allMembers.filter((currentMember) => currentMember.status === 'approved');
  const names = approvedMembers.map((currentMember) => currentMember.name);
  const pricePerPerson = approvedMembers.length > 0 ? Math.round((product.price / approvedMembers.length) * 100) / 100 : product.price;

  let warning: string | null = null;
  try {
    for (const currentMember of approvedMembers) {
      await sendMail(
        serviceRoleKey,
        currentMember.email,
        `Aggiornamento gruppo regalo "${product.name}"`,
        buildGroupUpdateEmailHtml({
          memberName: currentMember.name,
          productName: product.name,
          participantNames: names,
          pricePerPerson,
          totalPrice: product.price,
          myGroupUrl: siteUrl ? `${siteUrl.replace(/\/$/, '')}/#/il-mio-gruppo` : '#/',
        }),
      );
    }
  } catch {
    warning = 'Iscrizione completata, ma l’invio della mail di aggiornamento non è riuscito.';
  }

  return jsonResponse({
    member,
    isNewGroup,
    pricePerPerson,
    warning,
  });
});
