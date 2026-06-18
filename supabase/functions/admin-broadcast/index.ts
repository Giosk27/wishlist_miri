import webpush from 'npm:web-push';

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

interface BroadcastPayload {
  scope: 'all' | 'product';
  productId: string | null;
  subject: string;
  body: string;
  sendEmail: boolean;
  sendApp: boolean;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildAnnouncementHtml(subject: string, body: string): string {
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #4c1d95;">
      <h2 style="margin: 0 0 16px;">${escapeHtml(subject)}</h2>
      <p>${escapeHtml(body).replace(/\n/g, '<br>')}</p>
    </div>
  `;
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

async function getRecipientEmails(payload: BroadcastPayload, serviceRoleKey: string): Promise<string[]> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!supabaseUrl) throw new Error('Missing SUPABASE_URL');

  let membersPath = '/rest/v1/members?select=email&status=eq.approved';
  if (payload.scope === 'product' && payload.productId) {
    const groupsResponse = await supabaseFetch(`/rest/v1/gift_groups?select=id&product_id=eq.${payload.productId}`, serviceRoleKey);
    if (!groupsResponse.ok) {
      throw new Error(`Failed to load groups: ${groupsResponse.status}`);
    }
    const groups = await groupsResponse.json() as Array<{ id: string }>;
    const groupIds = groups.map((group) => group.id).filter(Boolean);
    if (groupIds.length === 0) return [];
    membersPath += `&group_id=in.(${groupIds.join(',')})`;
  }

  const response = await supabaseFetch(membersPath, serviceRoleKey);
  if (!response.ok) {
    throw new Error(`Failed to load recipients: ${response.status}`);
  }
  const data = await response.json() as Array<{ email: string }>;
  return Array.from(new Set(data.map((member) => member.email).filter(Boolean)));
}

async function sendMail(to: string, subject: string, html: string): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY');
  if (!supabaseUrl) throw new Error('Missing SUPABASE_URL');
  if (!serviceRoleKey) throw new Error('Missing SERVICE_ROLE_KEY');

  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/send-mail`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'x-client-info': 'wishlist-admin-broadcast',
    },
    body: JSON.stringify({ to, subject, html }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`send-mail failed: ${response.status} ${details}`);
  }
}

async function getPushSubscriptions(serviceRoleKey: string): Promise<Array<{ endpoint: string; auth: string; p256dh: string; expiration_time: string | null }>> {
  const response = await supabaseFetch('/rest/v1/push_subscriptions?select=endpoint,auth,p256dh,expiration_time', serviceRoleKey);
  if (!response.ok) {
    throw new Error(`Failed to load push subscriptions: ${response.status}`);
  }
  return await response.json() as Array<{ endpoint: string; auth: string; p256dh: string; expiration_time: string | null }>;
}

async function deletePushSubscription(endpoint: string, serviceRoleKey: string): Promise<void> {
  await supabaseFetch(`/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, serviceRoleKey, {
    method: 'DELETE',
  });
}

async function sendPushNotifications(subject: string, body: string, serviceRoleKey: string): Promise<number> {
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';
  if (!vapidPublicKey || !vapidPrivateKey) {
    throw new Error('Missing VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY');
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const subscriptions = await getPushSubscriptions(serviceRoleKey);
  const results = await Promise.allSettled(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            auth: subscription.auth,
            p256dh: subscription.p256dh,
          },
        },
        JSON.stringify({
          title: subject,
          body,
          url: './#/',
        }),
      );
      return true;
    } catch (error) {
      const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number((error as { statusCode?: number }).statusCode)
        : 0;
      if (statusCode === 404 || statusCode === 410) {
        await deletePushSubscription(subscription.endpoint, serviceRoleKey);
      }
      return false;
    }
  }));

  return results.reduce((count, result) => count + (result.status === 'fulfilled' && result.value ? 1 : 0), 0);
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

  let payload: BroadcastPayload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (!payload.subject?.trim() || !payload.body?.trim()) {
    return jsonResponse({ error: 'Missing subject or body' }, 400);
  }
  if (payload.scope === 'product' && !payload.productId) {
    return jsonResponse({ error: 'Missing productId' }, 400);
  }
  if (!payload.sendEmail && !payload.sendApp) {
    return jsonResponse({ error: 'No delivery channel selected' }, 400);
  }

  const emailCount = payload.sendEmail ? await (async () => {
    const recipients = await getRecipientEmails(payload, serviceRoleKey);
    const html = buildAnnouncementHtml(payload.subject, payload.body);
    for (const recipient of recipients) {
      await sendMail(recipient, payload.subject, html);
    }
    return recipients.length;
  })() : 0;

  let pushCount = 0;
  if (payload.sendApp) {
    const insertResponse = await supabaseFetch('/rest/v1/app_notifications', serviceRoleKey, {
      method: 'POST',
      body: JSON.stringify({
        title: payload.subject.trim(),
        body: payload.body.trim(),
        target_scope: payload.scope,
        target_product_id: payload.productId,
      }),
    });
    if (!insertResponse.ok) {
      const details = await insertResponse.text();
      return jsonResponse({ error: `Failed to store notification: ${insertResponse.status} ${details}` }, 500);
    }
    pushCount = await sendPushNotifications(payload.subject.trim(), payload.body.trim(), serviceRoleKey);
  }

  return jsonResponse({
    ok: true,
    emailCount,
    appCount: payload.sendApp ? 1 : 0,
    pushCount,
  });
});
