/**
 * Servizio email — PLACEHOLDER
 *
 * Consigliato per GitHub Pages:
 * - Supabase Edge Function `send-mail`
 * - Gmail API via Google OAuth2 refresh token
 *
 * Variabili opzionali nel frontend:
 *   VITE_EMAIL_API_URL=https://...   // se vuoi chiamare un endpoint esterno
 *   VITE_SITE_URL=https://tuousername.github.io/wishlist_site
 */

import type { Product } from '../types';

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

async function sendEmail(payload: EmailPayload): Promise<void> {
  const apiUrl = import.meta.env.VITE_EMAIL_API_URL;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (apiUrl) {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Email API error: ${response.status} ${response.statusText}`);
    }
    return;
  }

  if (supabaseUrl && supabaseAnonKey) {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/send-mail`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        'x-client-info': 'wishlist-site',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Edge Function error: ${response.status} ${response.statusText}${details ? ` - ${details}` : ''}`);
    }
    return;
  }

  if (!apiUrl) {
    console.info('[EMAIL PLACEHOLDER]', payload);
  }
}

export async function sendGroupUpdateEmail(params: {
  to: string;
  memberName: string;
  product: Product;
  groupMemberNames: string[];
  pricePerPerson: number;
  myGroupUrl: string;
}): Promise<void> {
  const { to, memberName, product, groupMemberNames, pricePerPerson, myGroupUrl } = params;

  await sendEmail({
    to,
    subject: `Aggiornamento gruppo regalo "${product.name}"`,
    html: `
      <h2>Ciao ${memberName}!</h2>
      <p>Il gruppo regalo per <strong>${product.name}</strong> è stato aggiornato.</p>
      <p>Partecipanti attuali: ${groupMemberNames.join(', ')}</p>
      <p><strong>Nuovo importo da pagare a persona: €${pricePerPerson.toFixed(2)}</strong></p>
      <p>Prezzo totale regalo: €${product.price.toFixed(2)}</p>
      <p><a href="${myGroupUrl}">Gestisci il tuo gruppo</a></p>
    `,
  });
}

export async function sendAdminAnnouncementEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  await sendEmail(params);
}

export function getSiteUrl(): string {
  return import.meta.env.VITE_SITE_URL || window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, '');
}

export function getMyGroupUrl(): string {
  return `${getSiteUrl()}/#/il-mio-gruppo`;
}
