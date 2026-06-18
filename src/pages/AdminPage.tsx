import { useEffect, useState } from 'react';
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

function formatError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'object' && err !== null) {
    const maybeMessage = 'message' in err ? (err as { message?: unknown }).message : undefined;
    if (typeof maybeMessage === 'string' && maybeMessage) return maybeMessage;
    const maybeDetails = 'details' in err ? (err as { details?: unknown }).details : undefined;
    if (typeof maybeDetails === 'string' && maybeDetails) return maybeDetails;
  }
  return 'Errore salvataggio prodotto.';
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

  const loadProducts = () => {
    getProducts().then(setProducts).catch(() => setError('Errore caricamento prodotti'));
  };

  const loadMembers = async () => {
    setMembersLoading(true);
    try {
      const data = await getAdminMembers();
      setMembers(data);
      setSelectedMembers((current) => current.filter((id) => data.some((member) => member.id === id)));
    } catch {
      setError('Errore caricamento utenti.');
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
      setMessage(parts.length > 0 ? `Invio completato: ${parts.join(' e ')}.` : 'Invio completato.');
      setAnnouncementSubject('');
      setAnnouncementBody('');
    } catch {
      setError('Errore durante l\'invio dell\'annuncio.');
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
            <button onClick={handleLogout} className="text-sm px-4 py-2 rounded-xl text-brand-500 hover:text-brand-700">
              Esci
            </button>
          </div>
        </div>

        {message && <Alert type="success" message={message} onClose={() => setMessage('')} />}
        {error && <Alert type="error" message={error} onClose={() => setError('')} />}

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
