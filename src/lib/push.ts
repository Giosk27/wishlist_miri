import { getCurrentAuthAccessToken } from './auth';
import { isSupabaseConfigured } from './supabase';

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }
  return output;
}

function getSubscriptionUrl(): string | null {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) return null;
  return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/push-subscriptions`;
}

export async function subscribeToPushNotifications(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
    throw new Error('Il browser non supporta le notifiche push.');
  }
  if (!isSupabaseConfigured) {
    throw new Error('Supabase non configurato.');
  }

  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!vapidPublicKey) {
    throw new Error('Manca VITE_VAPID_PUBLIC_KEY.');
  }

  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();

  if (permission !== 'granted') {
    throw new Error('Permesso notifiche non concesso.');
  }

  const accessToken = await getCurrentAuthAccessToken();
  if (!accessToken) {
    throw new Error('Devi effettuare l’accesso per attivare le notifiche push.');
  }

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToUint8Array(vapidPublicKey).buffer as ArrayBuffer,
  });

  const response = await fetch(getSubscriptionUrl()!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      'x-client-info': 'wishlist-site',
    },
    body: JSON.stringify(subscription),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Salvataggio subscription fallito: ${response.status} ${details}`);
  }

  return true;
}
