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

function buildMailShell(content: string, footer: string): string {
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; background:#faf5ff; padding:24px;">
      <div style="max-width:620px; margin:0 auto; background:#fff; border:1px solid #e9d5ff; border-radius:20px; overflow:hidden;">
        <div style="background:linear-gradient(135deg,#7c3aed,#c084fc); padding:24px; color:#fff;">
          <div style="font-size:20px; font-weight:700;">Wishlist · Regalo di gruppo</div>
        </div>
        <div style="padding:24px; color:#4c1d95;">
          ${content}
          <hr style="border:none; border-top:1px solid #e9d5ff; margin:24px 0;" />
          <p style="margin:0; font-size:12px; color:#7c3aed;">${footer}</p>
        </div>
      </div>
    </div>
  `;
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
    html: buildMailShell(
      `
        <h2 style="margin:0 0 12px; font-size:24px;">Ciao ${memberName}!</h2>
        <p style="margin:0 0 12px;">Il gruppo regalo per <strong>${product.name}</strong> è stato aggiornato.</p>
        <p style="margin:0 0 12px;">Partecipanti attuali: ${groupMemberNames.join(', ') || 'nessuno'}</p>
        <p style="margin:0 0 12px; font-weight:700;">Nuovo importo da pagare a persona: €${pricePerPerson.toFixed(2)}</p>
        <p style="margin:0 0 18px;">Prezzo totale regalo: €${product.price.toFixed(2)}</p>
        <a href="${myGroupUrl}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:12px 18px;border-radius:14px;font-weight:700;">Gestisci il tuo gruppo</a>
      `,
      'Se non riconosci questa email, puoi ignorarla tranquillamente.',
    ),
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
