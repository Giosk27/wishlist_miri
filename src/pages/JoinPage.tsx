import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import Layout from '../components/Layout';
import Alert from '../components/Alert';
import GroupCard from '../components/GroupCard';
import { getProduct, getPublicGroups, joinOrCreateGroup } from '../lib/api';
import { isValidEmail, sanitizePublicName, saveMemberSession } from '../lib/security';
import { getCurrentAuthUser } from '../lib/auth';
import { useSupabase } from '../lib/api';
import type { Product, PublicGroupView } from '../types';

export default function JoinPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const productId = params.get('product') ?? '';
  const groupId = params.get('group') ?? undefined;

  const [product, setProduct] = useState<Product | null>(null);
  const [existingGroup, setExistingGroup] = useState<PublicGroupView | null>(null);
  const [authUser, setAuthUser] = useState<{ id: string; email: string | null } | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (useSupabase) {
      getCurrentAuthUser().then(setAuthUser).catch(() => setAuthUser(null));
    }
    if (!productId) {
      setError('Prodotto non specificato.');
      setLoading(false);
      return;
    }
    Promise.all([getProduct(productId), getPublicGroups()])
      .then(([p, groups]) => {
        if (!p) throw new Error('Prodotto non trovato');
        setProduct(p);
        if (groupId) {
          setExistingGroup(groups.find((g) => g.group.id === groupId) ?? null);
        }
      })
      .catch((e: Error) => setError(e.message || 'Errore caricamento'))
      .finally(() => setLoading(false));
  }, [productId, groupId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!sanitizePublicName(name)) {
      setError('Inserisci un nome valido.');
      return;
    }
    if (!isValidEmail(email)) {
      setError('Inserisci un indirizzo email valido.');
      return;
    }

    setSubmitting(true);
    try {
      if (useSupabase && !authUser) {
        setError('Per partecipare devi prima accedere dalla sezione "Il mio gruppo".');
        return;
      }
      const result = await joinOrCreateGroup({
        productId,
        groupId,
        name: sanitizePublicName(name),
        email: useSupabase ? (authUser?.email ?? email.trim().toLowerCase()) : email.trim().toLowerCase(),
        authUserId: useSupabase ? authUser?.id ?? null : null,
      });

      saveMemberSession({
        memberId: result.member.id,
        groupId: result.member.group_id,
        name: result.member.name,
        email: result.member.email,
        sessionToken: result.member.session_token,
      });

      setSuccess(`Sei nel gruppo! Controlla la tua email: riceverai l'aggiornamento con il nuovo importo di €${result.pricePerPerson.toFixed(2)} a persona.`);
      setTimeout(() => navigate('/il-mio-gruppo'), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore durante l\'iscrizione');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="text-center py-20 text-brand-500">Caricamento...</div>
      </Layout>
    );
  }

  if (!product) {
    return (
      <Layout>
        <Alert type="error" message={error || 'Prodotto non trovato'} />
        <Link to="/" className="inline-block mt-4 text-brand-600 hover:underline">
          ← Torna alla wishlist
        </Link>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-lg mx-auto space-y-6">
        <div className="rounded-[1.75rem] border border-brand-100 bg-white/85 backdrop-blur-sm p-6 shadow-[0_16px_50px_rgba(91,33,182,0.08)]">
          <Link to="/" className="text-sm text-brand-600 hover:text-brand-900">
            ← Torna alla wishlist
          </Link>
          <h1 className="font-display text-3xl font-bold text-brand-900 mt-4">
            {groupId ? 'Unisciti al gruppo' : 'Crea un nuovo gruppo'}
          </h1>
          <p className="text-brand-600 mt-1">Regalo: {product.name} — €{product.price.toFixed(2)}</p>
        </div>

        {useSupabase && !authUser && (
          <Alert
            type="info"
            message='Per unire il tuo account a questo regalo usa prima "Il mio gruppo" per registrarti o accedere.'
          />
        )}

        {existingGroup && (
          <GroupCard view={existingGroup} compact />
        )}

        {error && <Alert type="error" message={error} />}
        {success && <Alert type="success" message={success} />}

        {!success && (
          <form onSubmit={handleSubmit} className="bg-white/90 rounded-[1.75rem] border border-brand-100 p-6 space-y-4 shadow-[0_16px_50px_rgba(91,33,182,0.08)]">
            <p className="text-sm text-brand-600">
              Il tuo nome sarà visibile sotto il regalo. L'email serve solo per l'accesso al tuo gruppo e per gli aggiornamenti.
            </p>
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-brand-800 mb-1">
                Nome
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
                placeholder="Es. Mario Rossi"
                required
                maxLength={50}
              />
            </div>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-brand-800 mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
                placeholder="tua@email.it"
                required
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 rounded-2xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-semibold transition-all shadow-sm"
            >
              {submitting ? 'Invio...' : groupId ? 'Unisciti al gruppo' : 'Crea gruppo e partecipa'}
            </button>
          </form>
        )}
      </div>
    </Layout>
  );
}
