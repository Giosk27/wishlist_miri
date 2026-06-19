# Checklist operativa

## 1) Supabase

- [ ] Esegui `supabase/schema.sql` nell’SQL Editor.
- [ ] Verifica che esistano `products`, `gift_groups`, `members`, `profiles`, `app_notifications`, `push_subscriptions`.
- [ ] Conferma che RLS sia attiva su tutte le tabelle.
- [ ] Crea i secret:
  - [ ] `ADMIN_PASSWORD`
  - [ ] `ADMIN_JWT_SECRET`
  - [ ] `SERVICE_ROLE_KEY`
  - [ ] `VITE_VAPID_PUBLIC_KEY`
  - [ ] `VAPID_PRIVATE_KEY`
  - [ ] `VAPID_SUBJECT`
  - [ ] `GOOGLE_CLIENT_ID`
  - [ ] `GOOGLE_CLIENT_SECRET`
  - [ ] `GOOGLE_REFRESH_TOKEN`
  - [ ] `GMAIL_FROM`

## 2) Edge Functions

- [ ] Deploia `send-mail`.
- [ ] Deploia `admin-auth`.
- [ ] Deploia `admin-broadcast`.
- [ ] Deploia `push-subscriptions`.
- [ ] Controlla i log di tutte e quattro le funzioni.
- [ ] Fai una prova manuale di `admin-auth` con password corretta e sbagliata.

## 3) Auth utenti

- [ ] Abilita Supabase Auth email/password.
- [ ] Decidi se attivare conferma email.
- [ ] Crea un utente test.
- [ ] Verifica che `profiles` venga popolata.
- [ ] Verifica che l’utente possa accedere alla sezione `Area utente`.

## 4) Frontend

- [ ] Configura `.env` / secret GitHub Pages:
  - [ ] `VITE_SUPABASE_URL`
  - [ ] `VITE_SUPABASE_ANON_KEY`
  - [ ] `VITE_VAPID_PUBLIC_KEY`
  - [ ] `VITE_BASE_PATH`
  - [ ] `VITE_SITE_URL`
  - [ ] `VITE_EMAIL_API_URL` solo se serve
- [ ] Build locale con `npm run build`.
- [ ] Verifica GitHub Pages con `npm run deploy` o workflow.
- [ ] Controlla su mobile che il layout sia usabile.

## 5) Flusso utente

- [ ] Registrazione.
- [ ] Login.
- [ ] Unione a un gruppo.
- [ ] Visualizzazione gruppo nella User Section.
- [ ] Cambio gruppo.
- [ ] Abbandono gruppo.
- [ ] Logout.

## 6) Admin

- [ ] Login admin server-side.
- [ ] Creazione/modifica prodotti.
- [ ] Upload immagine.
- [ ] Reset gruppi.
- [ ] Invio email a tutti.
- [ ] Invio notifica app.
- [ ] Invio combinato email + notifica.
- [ ] Attivazione notifiche push.

## 7) Test finali

- [ ] Test con browser desktop.
- [ ] Test con iPhone / mobile.
- [ ] Test di errore rete / secret mancanti.
- [ ] Test log Supabase per `send-mail`.
- [ ] Test log Supabase per `admin-auth` e `admin-broadcast`.

## Ordine consigliato

1. Supabase
2. Edge Functions
3. Auth utenti
4. Frontend
5. Flusso utente
6. Admin
7. Test finali
