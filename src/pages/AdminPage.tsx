import { useEffect, useState } from 'react';
import JSZip from 'jszip';
import Layout from '../components/Layout';
import Alert from '../components/Alert';
import {
  getProducts,
  getAdminMembers,
  deleteAdminMembers,
  saveProduct,
  deleteProduct,
  clearAllGroupData,
  clearGroupDataForProduct,
  clearAdminNotifications,
  sendAdminAnnouncement,
  uploadProductImage,
  useSupabase,
} from '../lib/api';
import {
  isAdminAuthenticated,
  setAdminSession,
  verifyAdminPassword,
} from '../lib/security';
import type { Product } from '../types';
import type { AdminMemberRecord } from '../lib/api';

const emptyForm = { name: '', price: '', description: '', image_url: '' };
type ProductImportRow = {
  image_filename: string;
  title: string;
  price_eur: string;
  notes?: string;
  local_image_path?: string;
};

function prettifyFileName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/, '');
  const cleaned = withoutExtension.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'Nuovo prodotto';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function normalizeFileName(fileName: string): string {
  return fileName.replace(/\\/g, '/').split('/').pop()?.toLowerCase().trim() ?? fileName.toLowerCase().trim();
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function parseProductImportCsv(csvText: string): ProductImportRow[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase());
  const required = ['image_filename', 'title', 'price_eur'];
  const missing = required.filter((column) => !headers.includes(column));
  if (missing.length > 0) {
    throw new Error(`CSV non valido: mancano le colonne ${missing.join(', ')}`);
  }

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])) as Record<string, string>;
    return {
      image_filename: row.image_filename ?? '',
      title: row.title ?? '',
      price_eur: row.price_eur ?? '',
      notes: row.notes ?? '',
      local_image_path: row.local_image_path ?? '',
    };
  });
}

function getImportDescription(row: ProductImportRow): string {
  const notes = row.notes?.trim();
  if (notes) return notes;
  return '';
}

async function loadZipImageMap(zipFile: File): Promise<Map<string, File>> {
  const zip = await JSZip.loadAsync(await zipFile.arrayBuffer());
  const imageMap = new Map<string, File>();

  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  for (const entry of entries) {
    const data = await entry.async('blob');
    const fileName = entry.name.split('/').pop() ?? entry.name;
    imageMap.set(normalizeFileName(fileName), new File([data], fileName, { type: data.type || 'image/jpeg' }));
  }

  return imageMap;
}

function formatError(err: unknown): string {
  const message = err instanceof Error && err.message ? err.message : '';
  if (message) {
    if (message.toLowerCase().includes('row-level security')) {
      return `${message} — controlla che le Edge Function siano redeployate e che i secret service role/admin siano corretti in Supabase.`;
    }
    return message;
  }
  if (typeof err === 'object' && err !== null) {
    const maybeMessage = 'message' in err ? (err as { message?: unknown }).message : undefined;
    if (typeof maybeMessage === 'string' && maybeMessage) {
      if (maybeMessage.toLowerCase().includes('row-level security')) {
        return `${maybeMessage} — controlla che le Edge Function siano redeployate e che i secret service role/admin siano corretti in Supabase.`;
      }
      return maybeMessage;
    }
    const maybeDetails = 'details' in err ? (err as { details?: unknown }).details : undefined;
    if (typeof maybeDetails === 'string' && maybeDetails) {
      if (maybeDetails.toLowerCase().includes('row-level security')) {
        return `${maybeDetails} — controlla che le Edge Function siano redeployate e che i secret service role/admin siano corretti in Supabase.`;
      }
      return maybeDetails;
    }
  }
  return 'Errore salvataggio prodotto.';
}

function isUnauthorizedError(err: unknown): boolean {
  const message = formatError(err);
  return message.includes('401') || message.toLowerCase().includes('unauthorized');
}

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState(isAdminAuthenticated());
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [clearing, setClearing] = useState(false);
  const [clearScope, setClearScope] = useState<'all' | 'product'>('all');
  const [clearProductId, setClearProductId] = useState('');
  const [clearingNotifications, setClearingNotifications] = useState(false);
  const [clearNotificationsScope, setClearNotificationsScope] = useState<'all' | 'product'>('all');
  const [clearNotificationsProductId, setClearNotificationsProductId] = useState('');
  const [announcementScope, setAnnouncementScope] = useState<'all' | 'product'>('all');
  const [announcementProductId, setAnnouncementProductId] = useState('');
  const [announcementSubject, setAnnouncementSubject] = useState('');
  const [announcementBody, setAnnouncementBody] = useState('');
  const [sendEmailChannel, setSendEmailChannel] = useState(true);
  const [sendAppChannel, setSendAppChannel] = useState(true);
  const [sendingAnnouncement, setSendingAnnouncement] = useState(false);
  const [members, setMembers] = useState<AdminMemberRecord[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [importCsvFile, setImportCsvFile] = useState<File | null>(null);
  const [importZipFile, setImportZipFile] = useState<File | null>(null);
  const [importingProducts, setImportingProducts] = useState(false);

  const loadProducts = () => {
    getProducts().then(setProducts).catch(() => setError('Errore caricamento prodotti'));
  };

  const loadMembers = async () => {
    setMembersLoading(true);
    try {
      const data = await getAdminMembers();
      setMembers(data);
      setSelectedMembers((current) => current.filter((id) => data.some((member) => member.id === id)));
    } catch (err) {
      if (isUnauthorizedError(err)) {
        setAdminSession(null);
        setAuthenticated(false);
        setLoginError('Sessione admin scaduta: accedi di nuovo.');
        return;
      }
      setError(`Errore caricamento utenti: ${formatError(err)}`);
    } finally {
      setMembersLoading(false);
    }
  };

  useEffect(() => {
    if (authenticated) {
      loadProducts();
      void loadMembers();
    }
  }, [authenticated]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = await verifyAdminPassword(password);
    if (token) {
      setAdminSession(token);
      setAuthenticated(true);
      setLoginError('');
    } else {
      setLoginError('Password non corretta.');
    }
  };

  const handleLogout = () => {
    setAdminSession(null);
    setAuthenticated(false);
    setPassword('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    const price = parseFloat(form.price);
    if (!form.name.trim() || isNaN(price) || price <= 0) {
      setError('Nome e prezzo validi sono obbligatori.');
      return;
    }

    setLoading(true);
    try {
      let imageUrl = form.image_url;
      if (imageFile) {
        imageUrl = await uploadProductImage(imageFile);
      }
      if (!imageUrl) {
        setError('Carica un\'immagine o inserisci un URL.');
        setLoading(false);
        return;
      }

      await saveProduct(
        {
          name: form.name.trim(),
          price,
          description: form.description.trim(),
          image_url: imageUrl,
        },
        editingId ?? undefined,
      );

      setMessage(editingId ? 'Prodotto aggiornato!' : 'Prodotto aggiunto!');
      setForm(emptyForm);
      setEditingId(null);
      setImageFile(null);
      loadProducts();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (product: Product) => {
    setEditingId(product.id);
    setForm({
      name: product.name,
      price: product.price.toString(),
      description: product.description,
      image_url: product.image_url,
    });
    setImageFile(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Eliminare questo prodotto e tutti i gruppi associati?')) return;
    try {
      await deleteProduct(id);
      loadProducts();
      setMessage('Prodotto eliminato.');
    } catch {
      setError('Errore eliminazione.');
    }
  };

  const handleBulkImport = async () => {
    if (!importCsvFile) {
      setError('Seleziona il CSV da importare.');
      return;
    }

    if (!importZipFile) {
      setError('Seleziona lo ZIP con le immagini.');
      return;
    }

    setImportingProducts(true);
    setError('');
    setMessage('');

    try {
      const csvText = await importCsvFile.text();
      const rows = parseProductImportCsv(csvText);
      if (rows.length === 0) {
        throw new Error('Il CSV non contiene righe da importare.');
      }

      const zipImageMap = await loadZipImageMap(importZipFile);

      for (const [index, row] of rows.entries()) {
        const rowNumber = index + 2;
        const normalizedImageName = normalizeFileName(row.image_filename);
        const imageFile = zipImageMap.get(normalizedImageName);
        if (!imageFile) {
          throw new Error(`Riga ${rowNumber}: immagine mancante nello ZIP (${row.image_filename}).`);
        }

        const price = Number.parseFloat(row.price_eur.replace(',', '.'));
        if (Number.isNaN(price) || price <= 0) {
          throw new Error(`Riga ${rowNumber}: prezzo non valido (${row.price_eur}).`);
        }

        let imageUrl: string;
        try {
          imageUrl = await uploadProductImage(imageFile);
        } catch (err) {
          throw new Error(`Riga ${rowNumber}: upload immagine fallito (${row.image_filename}) - ${formatError(err)}`);
        }

        try {
          await saveProduct({
            name: row.title.trim() || prettifyFileName(row.image_filename),
            price,
            description: getImportDescription(row),
            image_url: imageUrl,
          });
        } catch (err) {
          throw new Error(
            `Riga ${rowNumber}: salvataggio prodotto fallito (${row.image_filename}) - ${formatError(err)}`,
          );
        }
      }

      setImportCsvFile(null);
      setImportZipFile(null);
      loadProducts();
      setMessage(`Importati ${rows.length} prodotti.`);
    } catch (err) {
      setError(`Errore importazione prodotti: ${formatError(err)}`);
    } finally {
      setImportingProducts(false);
    }
  };

  const toggleMember = (id: string) => {
    setSelectedMembers((current) =>
      current.includes(id) ? current.filter((memberId) => memberId !== id) : [...current, id],
    );
  };

  const handleDeleteMembers = async (ids: string[]) => {
    if (ids.length === 0) return;
    if (!confirm(ids.length === 1 ? 'Eliminare questo utente?' : `Eliminare ${ids.length} utenti selezionati?`)) return;
    try {
      await deleteAdminMembers(ids);
      setMessage(ids.length === 1 ? 'Utente eliminato.' : 'Utenti eliminati.');
      setSelectedMembers([]);
      await loadMembers();
    } catch {
      setError('Errore eliminazione utenti.');
    }
  };

  const handleClearGroups = async () => {
    const label =
      clearScope === 'all'
        ? 'Svuotare tutti i gruppi e rimuovere tutte le persone iscritte? I prodotti resteranno.'
        : 'Svuotare solo il prodotto selezionato? Gruppi e iscritti di quel prodotto verranno rimossi, i prodotti resteranno.';
    if (clearScope === 'product' && !clearProductId) {
      setError('Seleziona un prodotto da svuotare.');
      return;
    }
    if (!confirm(label)) return;
    setClearing(true);
    setError('');
    setMessage('');
    try {
      if (clearScope === 'all') {
        await clearAllGroupData();
        setMessage('Tutti i gruppi e gli iscritti sono stati eliminati.');
      } else {
        await clearGroupDataForProduct(clearProductId);
        setMessage('Gruppo e iscritti del prodotto eliminati.');
      }
    } catch {
      setError('Errore durante il reset dei gruppi.');
    } finally {
      setClearing(false);
    }
  };

  const handleClearNotifications = async () => {
    if (clearNotificationsScope === 'product' && !clearNotificationsProductId) {
      setError('Seleziona un prodotto da svuotare.');
      return;
    }

    const label =
      clearNotificationsScope === 'all'
        ? 'Svuotare tutte le notifiche app/web?'
        : 'Svuotare solo le notifiche del prodotto selezionato?';
    if (!confirm(label)) return;

    setClearingNotifications(true);
    setError('');
    setMessage('');
    try {
      await clearAdminNotifications({
        scope: clearNotificationsScope,
        productId: clearNotificationsScope === 'product' ? clearNotificationsProductId : null,
      });
      setMessage(clearNotificationsScope === 'all'
        ? 'Tutte le notifiche sono state eliminate.'
        : 'Notifiche del prodotto eliminate.');
    } catch (err) {
      if (isUnauthorizedError(err)) {
        setAdminSession(null);
        setAuthenticated(false);
        setLoginError('Sessione admin scaduta: accedi di nuovo.');
        return;
      }
      setError(`Errore durante il reset notifiche: ${formatError(err)}`);
    } finally {
      setClearingNotifications(false);
    }
  };

  const handleSendAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (!announcementSubject.trim() || !announcementBody.trim()) {
      setError("Inserisci oggetto e testo dell'annuncio.");
      return;
    }
    if (announcementScope === 'product' && !announcementProductId) {
      setError("Seleziona un prodotto per l'annuncio.");
      return;
    }
    if (!sendEmailChannel && !sendAppChannel) {
      setError('Seleziona almeno una destinazione.');
      return;
    }

    setSendingAnnouncement(true);
    try {
      const result = await sendAdminAnnouncement({
        scope: announcementScope,
        productId: announcementScope === 'product' ? announcementProductId : null,
        subject: announcementSubject.trim(),
        body: announcementBody.trim(),
        sendEmail: sendEmailChannel,
        sendApp: sendAppChannel,
      });
      const parts: string[] = [];
      if (sendEmailChannel) parts.push(`${result.emailCount} email`);
      if (sendAppChannel) parts.push(`${result.appCount} notifica app`);
      if (result.pushCount > 0) parts.push(`${result.pushCount} push`);
      setMessage(parts.length > 0 ? `Invio completato: ${parts.join(' e ')}.` : 'Invio completato.');
      setAnnouncementSubject('');
      setAnnouncementBody('');
    } catch (err) {
      if (isUnauthorizedError(err)) {
        setAdminSession(null);
        setAuthenticated(false);
        setLoginError('Sessione admin scaduta: accedi di nuovo.');
        return;
      }
      setError(`Errore durante l'invio dell'annuncio: ${formatError(err)}`);
    } finally {
      setSendingAnnouncement(false);
    }
  };

  if (!authenticated) {
    return (
      <Layout>
        <div className="max-w-md mx-auto space-y-6 py-6 sm:py-10">
          <div className="rounded-[1.75rem] border border-brand-100 bg-white/85 backdrop-blur-sm p-6 shadow-[0_16px_50px_rgba(91,33,182,0.08)] text-center">
            <h1 className="font-display text-3xl font-bold text-brand-900">Admin</h1>
            <p className="mt-2 text-sm text-brand-600">Gestisci prodotti, immagini e prezzi.</p>
          </div>
          {loginError && <Alert type="error" message={loginError} />}
          <form onSubmit={handleLogin} className="bg-white/90 rounded-[1.75rem] border border-brand-100 p-6 space-y-4 shadow-[0_16px_50px_rgba(91,33,182,0.08)]">
            <div>
              <label htmlFor="admin-pw" className="block text-sm font-medium text-brand-800 mb-1">
                Password
              </label>
              <input
                id="admin-pw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
                required
              />
            </div>
            <button type="submit" className="w-full py-3 rounded-2xl bg-brand-600 text-white font-semibold hover:bg-brand-700 shadow-sm">
              Accedi
            </button>
          </form>
          <p className="text-xs text-center text-brand-400">
            Il login admin usa le Edge Function Supabase; `VITE_ADMIN_PASSWORD` serve solo in demo locale.
          </p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-[1.75rem] border border-brand-100 bg-white/85 backdrop-blur-sm p-5 sm:p-6 shadow-[0_16px_50px_rgba(91,33,182,0.08)]">
          <div>
            <h1 className="font-display text-3xl font-bold text-brand-900">Pannello Admin</h1>
            <p className="text-sm text-brand-600 mt-1">Prodotti sì, iscritti no: qui puoi ripulire i gruppi.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 self-start">
            <div className="flex flex-col gap-2">
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  value={clearScope}
                  onChange={(e) => setClearScope(e.target.value as 'all' | 'product')}
                  className="text-sm px-3 py-2 rounded-xl border border-brand-200 bg-white text-brand-700"
                >
                  <option value="all">Tutti i gruppi</option>
                  <option value="product">Solo un prodotto</option>
                </select>
                {clearScope === 'product' && (
                  <select
                    value={clearProductId}
                    onChange={(e) => setClearProductId(e.target.value)}
                    className="text-sm px-3 py-2 rounded-xl border border-brand-200 bg-white text-brand-700"
                  >
                    <option value="">Seleziona prodotto</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <button
                onClick={handleClearGroups}
                disabled={clearing}
                className="text-sm px-4 py-2 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-50"
              >
                {clearing ? 'Pulizia...' : 'Svuota'}
              </button>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  value={clearNotificationsScope}
                  onChange={(e) => setClearNotificationsScope(e.target.value as 'all' | 'product')}
                  className="text-sm px-3 py-2 rounded-xl border border-brand-200 bg-white text-brand-700"
                >
                  <option value="all">Tutte le notifiche</option>
                  <option value="product">Solo un prodotto</option>
                </select>
                {clearNotificationsScope === 'product' && (
                  <select
                    value={clearNotificationsProductId}
                    onChange={(e) => setClearNotificationsProductId(e.target.value)}
                    className="text-sm px-3 py-2 rounded-xl border border-brand-200 bg-white text-brand-700"
                  >
                    <option value="">Seleziona prodotto</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <button
                onClick={handleClearNotifications}
                disabled={clearingNotifications}
                className="text-sm px-4 py-2 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-50"
              >
                {clearingNotifications ? 'Pulizia...' : 'Svuota notifiche'}
              </button>
            </div>
            <button onClick={handleLogout} className="text-sm px-4 py-2 rounded-xl text-brand-500 hover:text-brand-700">
              Esci
            </button>
          </div>
        </div>

        {message && <Alert type="success" message={message} onClose={() => setMessage('')} />}
        {error && <Alert type="error" message={error} onClose={() => setError('')} />}

        <section className="bg-white/90 rounded-[1.75rem] border border-brand-100 p-5 sm:p-6 space-y-4 shadow-[0_16px_50px_rgba(91,33,182,0.08)]">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold text-brand-900">Import CSV + ZIP prodotti</h2>
              <p className="text-sm text-brand-600 mt-1">
                Carica il CSV ordinato e lo ZIP con le immagini abbinate per nome file.
              </p>
            </div>
            <span className="text-xs font-medium rounded-full bg-brand-50 text-brand-700 px-3 py-1 self-start">
              Sezione rapida
            </span>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1">CSV prodotti</label>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setImportCsvFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-brand-600"
              />
              {importCsvFile && (
                <p className="mt-2 text-xs text-brand-500">
                  {importCsvFile.name}
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1">ZIP immagini</label>
              <input
                type="file"
                accept=".zip,application/zip"
                onChange={(e) => setImportZipFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-brand-600"
              />
              {importZipFile && (
                <p className="mt-2 text-xs text-brand-500">
                  {importZipFile.name}
                </p>
              )}
            </div>
          </div>
          <p className="text-xs text-brand-500">
            Il CSV deve contenere almeno le colonne <span className="font-medium">image_filename</span>, <span className="font-medium">title</span> e <span className="font-medium">price_eur</span>.
          </p>
          <button
            type="button"
            onClick={handleBulkImport}
            disabled={importingProducts}
            className="px-6 py-3 rounded-2xl bg-brand-600 text-white font-semibold hover:bg-brand-700 disabled:opacity-50 shadow-sm"
          >
            {importingProducts ? 'Importazione...' : 'Importa prodotti'}
          </button>
        </section>

        <form onSubmit={handleSendAnnouncement} className="bg-white/90 rounded-[1.75rem] border border-brand-100 p-5 sm:p-6 space-y-4 shadow-[0_16px_50px_rgba(91,33,182,0.08)]">
          <h2 className="font-semibold text-brand-900">Invia annuncio</h2>
          <p className="text-sm text-brand-600">Puoi inviare lo stesso messaggio via email, come notifica app, o entrambi.</p>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1">Destinatari</label>
              <select
                value={announcementScope}
                onChange={(e) => setAnnouncementScope(e.target.value as 'all' | 'product')}
                className="w-full px-3 py-2.5 rounded-xl border border-brand-200 bg-white text-brand-700"
              >
                <option value="all">Tutti i gruppi</option>
                <option value="product">Solo un prodotto</option>
              </select>
            </div>
            {announcementScope === 'product' && (
              <div>
                <label className="block text-sm font-medium text-brand-800 mb-1">Prodotto</label>
                <select
                  value={announcementProductId}
                  onChange={(e) => setAnnouncementProductId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-brand-200 bg-white text-brand-700"
                >
                  <option value="">Seleziona prodotto</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-brand-700">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={sendEmailChannel}
                onChange={(e) => setSendEmailChannel(e.target.checked)}
                className="rounded border-brand-300 text-brand-600 focus:ring-brand-500"
              />
              Email
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={sendAppChannel}
                onChange={(e) => setSendAppChannel(e.target.checked)}
                className="rounded border-brand-300 text-brand-600 focus:ring-brand-500"
              />
              Notifica app
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1">Oggetto</label>
            <input
              value={announcementSubject}
              onChange={(e) => setAnnouncementSubject(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
              placeholder="Es. Promemoria evento"
              maxLength={120}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1">Messaggio</label>
            <textarea
              value={announcementBody}
              onChange={(e) => setAnnouncementBody(e.target.value)}
              className="w-full min-h-[140px] px-4 py-3 rounded-xl border border-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
              placeholder="Scrivi qui l'annuncio..."
            />
          </div>
          <button
            type="submit"
            disabled={sendingAnnouncement}
            className="px-4 py-2.5 rounded-xl bg-brand-600 text-white font-semibold hover:bg-brand-700 disabled:opacity-50"
          >
            {sendingAnnouncement ? 'Invio...' : 'Invia'}
          </button>
        </form>

        <section className="bg-white/90 rounded-[1.75rem] border border-brand-100 p-5 sm:p-6 space-y-4 shadow-[0_16px_50px_rgba(91,33,182,0.08)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold text-brand-900">Utenti iscritti ({members.length})</h2>
              <p className="text-sm text-brand-600">Puoi eliminare una o più persone dal gruppo.</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSelectedMembers(members.map((member) => member.id))}
                className="px-4 py-2 rounded-xl border border-brand-200 text-brand-700 hover:bg-brand-50 text-sm"
              >
                Seleziona tutti
              </button>
              <button
                type="button"
                onClick={() => setSelectedMembers([])}
                className="px-4 py-2 rounded-xl border border-brand-200 text-brand-700 hover:bg-brand-50 text-sm"
              >
                Deseleziona
              </button>
              <button
                type="button"
                disabled={selectedMembers.length === 0}
                onClick={() => handleDeleteMembers(selectedMembers)}
                className="px-4 py-2 rounded-xl bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-50 text-sm"
              >
                Elimina selezionati
              </button>
            </div>
          </div>

          {membersLoading ? (
            <p className="text-sm text-brand-500">Caricamento utenti...</p>
          ) : members.length === 0 ? (
            <p className="text-brand-500">Nessun utente iscritto.</p>
          ) : (
            <div className="grid gap-3">
              {members.map((member) => (
                <label
                  key={member.id}
                  className="flex flex-col gap-3 rounded-2xl border border-brand-100 bg-brand-50/40 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedMembers.includes(member.id)}
                      onChange={() => toggleMember(member.id)}
                      className="mt-1 rounded border-brand-300 text-brand-600 focus:ring-brand-500"
                    />
                    <div>
                      <p className="font-semibold text-brand-900">{member.name}</p>
                      <p className="text-sm text-brand-600">{member.email}</p>
                      <p className="text-xs text-brand-500">
                        {member.product_name || 'Prodotto sconosciuto'} · {member.status}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 self-start sm:self-auto">
                    <button
                      type="button"
                      onClick={() => handleDeleteMembers([member.id])}
                      className="px-3 py-2 rounded-xl bg-rose-50 text-rose-700 hover:bg-rose-100 text-sm"
                    >
                      Elimina
                    </button>
                  </div>
                </label>
              ))}
            </div>
          )}
        </section>

        <form onSubmit={handleSubmit} className="bg-white/90 rounded-[1.75rem] border border-brand-100 p-5 sm:p-6 space-y-4 shadow-[0_16px_50px_rgba(91,33,182,0.08)]">
          <h2 className="font-semibold text-brand-900">{editingId ? 'Modifica prodotto' : 'Nuovo prodotto'}</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1">Nome prodotto</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1">Prezzo (€)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1">Descrizione</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              className="w-full px-4 py-2.5 rounded-xl border border-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1">Carica foto</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-brand-600"
              />
              {!useSupabase && (
                <p className="text-xs text-brand-400 mt-1">In modalità locale l'immagine viene salvata come base64.</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1">Oppure URL immagine</label>
              <input
                value={form.image_url}
                onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                placeholder="https://..."
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-3 rounded-2xl bg-brand-600 text-white font-semibold hover:bg-brand-700 disabled:opacity-50 shadow-sm"
            >
              {loading ? 'Salvataggio...' : editingId ? 'Aggiorna' : 'Aggiungi prodotto'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setForm(emptyForm);
                  setImageFile(null);
                }}
                className="px-6 py-3 rounded-2xl border border-brand-200 text-brand-700 hover:bg-brand-50"
              >
                Annulla
              </button>
            )}
          </div>
        </form>

        <div className="space-y-4">
          <h2 className="font-semibold text-brand-900">Prodotti ({products.length})</h2>
          {products.length === 0 ? (
            <p className="text-brand-500">Nessun prodotto ancora.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {products.map((p) => (
                <div key={p.id} className="bg-white/90 rounded-[1.5rem] border border-brand-100 overflow-hidden shadow-[0_14px_50px_rgba(91,33,182,0.08)]">
                  <div className="p-4 sm:p-5 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-brand-100 border border-brand-200">
                        {p.image_url ? (
                          <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-2xl">🎁</div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-brand-900 truncate">{p.name}</h3>
                        <p className="text-brand-600">€{p.price.toFixed(2)}</p>
                      </div>
                    </div>
                    <p className="text-sm text-brand-600/80 line-clamp-2">{p.description || 'Nessuna descrizione.'}</p>
                    <div className="flex flex-col sm:flex-row gap-2 pt-2">
                      <button
                        onClick={() => startEdit(p)}
                        className="text-sm px-3 py-2 rounded-xl bg-brand-100 text-brand-700 hover:bg-brand-200"
                      >
                        Modifica
                      </button>
                      <button
                        onClick={() => handleDelete(p.id)}
                        className="text-sm px-3 py-2 rounded-xl bg-rose-50 text-rose-700 hover:bg-rose-100"
                      >
                        Elimina
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
