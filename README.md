# Wishlist Regalo di Gruppo

Web-app per gestire una wishlist con regali di gruppo: ogni partecipante sceglie un regalo, si unisce a un gruppo (o ne crea uno), riceve email di conferma con la quota da pagare, e può segnare il regalo come comprato.

## Funzionalità

- **Wishlist pubblica** — prodotti con foto, nome, prezzo e gruppi visibili (solo nomi, mai email)
- **Partecipazione** — nome + email, un solo gruppo per prodotto
- **Gruppi esistenti** — unirsi aggiorna subito tutto il gruppo via email
- **Aggiornamenti email** — importo a persona calcolato automaticamente (prezzo ÷ n° partecipanti)
- **Il mio gruppo** — login con email, cambio gruppo, segna come comprato
- **Admin** — `/admin` protetto da password per gestire prodotti, foto e invii massivi
- **Notifiche web** — annunci visibili nell'app e, se autorizzato, notifiche del browser

## Stack

- React + TypeScript + Vite + Tailwind CSS
- Supabase (database + storage immagini) con Row Level Security
- GitHub Pages (HashRouter per routing statico)
- Email: Supabase Edge Function `send-mail` oppure endpoint esterno

## Avvio locale

```bash
npm install
cp .env.example .env
# Modifica .env con le tue credenziali

npm run dev
```

Senza Supabase configurato, l'app usa **localStorage** in modalità demo (solo sul tuo browser).

### Accesso da iPhone o altri dispositivi in rete locale

Per aprire il sito da iPhone mentre lo stai eseguendo in locale:

```bash
npm run dev:host
```

Poi:

1. Assicurati che Mac e iPhone siano sulla stessa rete Wi-Fi
2. Apri sul telefono l'indirizzo IP locale del Mac, ad esempio `http://192.168.1.20:5173`
3. Se macOS chiede il permesso per le connessioni in ingresso, consenti `Node` o `vite`

Se vuoi vedere una build di preview in rete locale:

```bash
npm run preview:host
```

## Setup Supabase

1. Crea un progetto su [supabase.com](https://supabase.com)
2. Esegui lo script SQL in `supabase/schema.sql` dall'SQL Editor
3. Crea un bucket Storage `product-images` (pubblico in lettura)
4. Copia URL e anon key in `.env`
5. Verifica che la policy `storage.objects` per `INSERT` sia attiva per il bucket `product-images`

## Deploy su GitHub Pages

```bash
npm run deploy
```

Oppure abilita GitHub Actions (`.github/workflows/deploy.yml`).

Imposta i **GitHub Secrets** per le variabili `VITE_*` nel workflow:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_BASE_PATH`
- `VITE_SITE_URL`
- `VITE_EMAIL_API_URL` solo se usi un endpoint esterno

Nota: tutto ciò che inizia con `VITE_` finisce nel bundle del sito e quindi è leggibile dal browser.  
Per questo la password admin non va messa in `VITE_*`: il login vero è gestito dalle Edge Function.

URL admin: `https://tuousername.github.io/wishlist_site/#/admin`

## Sicurezza

- Le **email non sono esposte** nelle API pubbliche (view `members_public` senza colonna email)
- Accesso membro tramite hash email + session token
- Admin protetto da password in variabile d'ambiente del build, ma **non trattarla come segreto forte** su GitHub Pages
- Per email in produzione usa una **Edge Function** Supabase, non API key nel client
- Le notifiche "app" qui sono feed web/browser nel sito; per push vere su app chiusa serve una PWA completa con service worker

### Password admin

Se vuoi sicurezza reale, la password non va validata nel frontend:

- salva un hash o un secret solo lato server
- verifica la password in una Edge Function Supabase
- rilascia al frontend solo una sessione temporanea

Su GitHub Pages il client resta pubblico, quindi una password in `VITE_*` è solo una protezione pratica, non una difesa forte.

## Configurazione email

Il codice è già predisposto per inviare email tramite:

- una `Supabase Edge Function` chiamata `send-mail`
- oppure un endpoint esterno impostato con `VITE_EMAIL_API_URL`

### Cosa fare fuori dal codice

1. Apri Google Cloud Console e crea un progetto.
2. Abilita la Gmail API nel progetto.
3. Configura lo schermo OAuth e crea le credenziali OAuth 2.0 per applicazione web.
4. Ottieni un `refresh_token` con scope `https://www.googleapis.com/auth/gmail.send`.
5. Salva i secrets server-side nel progetto Supabase:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REFRESH_TOKEN`
   - `GMAIL_FROM` con la tua mail Gmail verificata
6. In Supabase, deploya la funzione `send-mail` presente in `supabase/functions/send-mail/index.ts`.
7. Aggiorna `VITE_SITE_URL` con l'URL pubblico corretto del sito.

### Come ottenere il refresh token

Se hai già `project_id`, `auth_uri`, `token_uri` e gli altri campi OAuth, ti manca solo la fase di autorizzazione utente:

1. Apri un URL di consenso Google con questi parametri:
   - `client_id=...`
   - `redirect_uri=...`
   - `response_type=code`
   - `scope=https://www.googleapis.com/auth/gmail.send`
   - `access_type=offline`
   - `prompt=consent`
2. Accedi con l'account Gmail che userai come mittente.
3. Concedi i permessi.
4. Google ti reindirizza a una `redirect_uri` con un `code`.
5. Scambia il `code` con i token usando `token_uri=https://oauth2.googleapis.com/token`.
6. La risposta iniziale include `refresh_token`.

Se non vedi il `refresh_token`, di solito devi revocare l’accesso applicazione e rifare l’autorizzazione con `access_type=offline` e `prompt=consent`.
Se invece ricevi `403: org_internal`, il progetto OAuth è limitato agli utenti della tua organizzazione Google Workspace: in Google Cloud Console imposta il consenso come `External` e aggiungi il tuo account Gmail tra i `Test users`.
Se invece ricevi `unauthorized_client` nel Playground, controlla queste 3 cose:

1. Il client OAuth deve essere di tipo `Web application`, non `Desktop app`.
2. Tra gli `Authorized redirect URIs` deve esserci `https://developers.google.com/oauthplayground`.
3. Nel Playground devi usare il client ID e il client secret dello stesso progetto Google Cloud in cui hai abilitato la Gmail API.

Il Playground è solo un modo comodo per ottenere il `code` e il `refresh_token`: per l'invio vero usiamo comunque la funzione Supabase `send-mail`.

### Variabili frontend

- `VITE_SITE_URL`
- `VITE_EMAIL_API_URL` opzionale, solo se usi un endpoint esterno

### Note importanti

- Non mettere chiavi segrete nel frontend: tutto ciò che inizia con `VITE_` finisce nel bundle pubblico.
- Se usi la funzione Supabase, il frontend chiama `send-mail` e la chiave del provider resta solo nei secrets di Supabase.
- Dopo il deploy, testa l'invio creando un gruppo o aggiungendo un partecipante: il sito manda email con il gruppo aggiornato e il nuovo importo a persona.
- Con Gmail API, usa la tua casella Gmail come `GMAIL_FROM` e autorizza il progetto Google con OAuth 2.0.
- Se vedi `Failed to send a request to the Edge Function`, di solito la funzione non è deployata nel progetto giusto, i secrets Google mancano, oppure il browser sta bloccando la preflight. Controlla anche i log della funzione in Supabase.

## Flusso gruppi

- Quando un utente entra in un gruppo, il gruppo viene aggiornato subito.
- Tutti i partecipanti ricevono una mail con il nuovo elenco nomi e il nuovo importo a persona.
- Non serve più un passaggio di approvazione manuale.

## Roadmap sicurezza utenti

Per passare a una gestione davvero server-side, il consiglio è usare **Supabase Auth** per gli utenti e RLS per i dati.

- Le password non vanno salvate "crittate" nel browser o nel frontend.
- Le password devono essere gestite da Supabase Auth: nel database resta solo l'hash, non la password in chiaro.
- Le tabelle dati devono essere protette con RLS e policy basate sull'utente autenticato.
- La sezione `Il mio gruppo` diventa una **User Section** con accesso autenticato, profilo e gruppo collegato all'account.
- Le notifiche push vere richiedono un service worker, una subscription salvata in Supabase e i secret VAPID.

Per l’ordine operativo usa `CHECKLIST.md`.

### Checklist Admin

- Creare `ADMIN_PASSWORD` e `ADMIN_JWT_SECRET` come secrets Supabase.
- Tenere `SERVICE_ROLE_KEY` solo lato server.
- Tenere `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` come secrets Supabase.
- Deployare `admin-auth`, `admin-broadcast` e `push-subscriptions`.
- Verificare che `products`, `gift_groups`, `members`, `app_notifications`, `push_subscriptions` abbiano RLS attive.
- Spostare eventuali operazioni distruttive o sensibili dentro Edge Functions.
- Testare: login admin, upload prodotto, reset gruppi, invio email, invio notifiche app, invio push.

### Checklist Utenti

- Abilitare Supabase Auth per email/password.
- Creare una tabella `profiles` collegata a `auth.users`.
- Collegare ogni account utente al proprio gruppo o ai propri gruppi autorizzati.
- Spostare `Il mio gruppo` in una dashboard privata autenticata.
- Permettere modifica dati personali, visualizzazione gruppo, stato acquisti e notifiche.
- Applicare RLS per consentire accesso solo ai record dell'utente loggato.
- Testare: registrazione, login, recupero password, accesso al gruppo, modifica dati, logout.

## Notifiche mobile

Se vuoi notifiche vere su iPhone e Android, il sito va trasformato in una PWA:

- aggiungi `manifest` e `service worker`
- chiedi il permesso notifiche solo dopo un tap dell'utente
- usa il Push API / Notifications API
- invia le push dal backend con una subscription salvata server-side

GitHub Pages può ospitare la parte front-end/PWA, ma l'invio push richiede comunque un backend.
Il pannello admin attuale può già inviare:

- email ai partecipanti
- notifiche web visibili nell'app
- notifiche del browser, se l'utente ha dato il permesso

### Secret Supabase da impostare

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GMAIL_FROM`
- `ADMIN_PASSWORD`
- `ADMIN_JWT_SECRET`
- `SUPABASE_URL`
- `SERVICE_ROLE_KEY`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`

La variabile `VITE_ADMIN_PASSWORD` resta utile solo per la modalità demo locale, non per il deploy pubblico.
Per le push PWA serve anche `VAPID_PUBLIC_KEY` nel build frontend.

### Nota importante su "crittatura"

Per gli account utente, la cosa corretta è:

- password gestite da Supabase Auth
- hash sicuri lato server
- nessuna password in chiaro nel client

Per i dati personali, la sicurezza vera arriva da:

- RLS
- secrets server-side
- Edge Functions per operazioni sensibili
- niente chiavi privilegiate nel frontend

## Reset gruppi

Se vuoi cancellare gli iscritti e ripartire con i soli prodotti:

1. Vai in `/admin`
2. Scegli `Tutti i gruppi` oppure `Solo un prodotto`
3. Usa il pulsante `Svuota`
4. I prodotti restano salvati, ma gruppi e iscritti selezionati vengono eliminati

## Struttura

```
src/
  components/   # UI riutilizzabili
  lib/          # API, email, sicurezza, Supabase
  pages/        # Home, Partecipa, Il mio gruppo, Admin, Approva
  types/        # TypeScript types
supabase/
  schema.sql    # Schema DB + RLS policies
```
