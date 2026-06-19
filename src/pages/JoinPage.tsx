import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
  const routeParams = useParams<{ productId: string }>();
  const routeProductId = routeParams.productId ?? '';
  const productId = routeProductId || params.get('product') || '';
  const groupId = params.get('group') ?? undefined;
  const redirectTarget = `/il-mio-gruppo?redirect=${encodeURIComponent(`/prodotto/${productId}${groupId ? `?group=${groupId}` : ''}`)}`;

  const [product, setProduct] = useState<Product | null>(null);
  const [productGroups, setProductGroups] = useState<PublicGroupView[]>([]);
  const [existingGroup, setExistingGroup] = useState<PublicGroupView | null>(null);
  const [authUser, setAuthUser] = useState<{ id: string; email: string | null } | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [imageOpen, setImageOpen] = useState(false);

  const handleRequireLogin = () => {
    navigate(redirectTarget);
  };

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
        const filtered = groups.filter((group) => group.product.id === p.id);
        setProduct(p);
        setProductGroups(filtered);
        if (groupId) {
          setExistingGroup(filtered.find((group) => group.group.id === groupId) ?? null);
        }
      })
      .catch((e: Error) => setError(e.message || 'Errore caricamento'))
      .finally(() => setLoading(false));
  }, [productId, groupId]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!sanitizePublicName(name)) {
      setError('Inserisci un nome valido.');
      return;
    }
    const resolvedEmail = useSupabase ? authUser?.email ?? '' : '';
    if (useSupabase && !authUser) {
      handleRequireLogin();
      return;
    }
    if (!useSupabase && !isValidEmail(email)) {
      setError('Inserisci un indirizzo email valido.');
      return;
    }
    if (useSupabase && !isValidEmail(resolvedEmail)) {
      setError('L’account autenticato non ha un’email valida.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await joinOrCreateGroup({
        productId,
        groupId,
        name: sanitizePublicName(name),
        email: useSupabase ? resolvedEmail.trim().toLowerCase() : email.trim().toLowerCase(),
        authUserId: useSupabase ? authUser?.id ?? null : null,
      });

      saveMemberSession({
        memberId: result.member.id,
        groupId: result.member.group_id,
        name: result.member.name,
        email: result.member.email,
        sessionToken: result.member.session_token,
      });

      const warning = result.warning ? ` ${result.warning}` : '';
      setSuccess(`Sei nel gruppo! Controlla la tua email: riceverai l'aggiornamento con il nuovo importo di €${result.pricePerPerson.toFixed(2)} a persona.${warning}`);
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
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="overflow-hidden rounded-[2rem] border border-brand-100 bg-white/90 shadow-[0_20px_70px_rgba(91,33,182,0.08)]">
          <button type="button" onClick={() => setImageOpen(true)} className="block w-full">
            <div className="relative aspect-[4/5] sm:aspect-[16/10] bg-gradient-to-br from-brand-50 to-white">
              {product.image_url ? (
                <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full flex items-center justify-center text-7xl">🎁</div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/45 to-transparent p-5 text-left">
                <span className="inline-flex rounded-full bg-white/90 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-brand-700">
                  Tocca per aprire
                </span>
              </div>
            </div>
          </button>
          <div className="p-6 sm:p-8">
            <Link to="/" className="text-sm text-brand-600 hover:text-brand-900">
              ← Torna alla wishlist
            </Link>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-400">Dettagli prodotto</p>
                <h1 className="font-display text-3xl sm:text-4xl font-bold text-brand-900 mt-2">{product.name}</h1>
                <p className="mt-2 text-lg text-brand-600">€{product.price.toFixed(2)}</p>
              </div>
              <button
                type="button"
                onClick={() => setImageOpen(true)}
                className="inline-flex items-center justify-center rounded-2xl border border-brand-200 bg-white px-4 py-2.5 text-sm font-semibold text-brand-700 hover:border-brand-500 hover:text-brand-900"
              >
                Apri immagine
              </button>
            </div>
            {product.description && (
              <p className="mt-5 text-sm sm:text-base leading-7 text-brand-700/80">{product.description}</p>
            )}
          </div>
        </div>

        {useSupabase && !authUser && (
          <div className="rounded-[1.5rem] border border-brand-100 bg-white/90 p-6 shadow-[0_14px_40px_rgba(91,33,182,0.08)]">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-500">Accesso richiesto</p>
            <h2 className="mt-2 font-display text-2xl font-semibold text-brand-900">Per unirti a un gruppo devi essere loggato</h2>
            <p className="mt-2 text-sm text-brand-600">
              Ti portiamo direttamente alla login, poi torni qui in automatico.
            </p>
            <Link
              to={redirectTarget}
              className="mt-4 inline-flex rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Accedi per unirti
            </Link>
          </div>
        )}

        {productGroups.length > 0 && (
          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-400">Gruppo disponibile</p>
              <h2 className="mt-1 font-display text-2xl font-semibold text-brand-900">Regalo condiviso</h2>
            </div>
            <GroupCard
              view={existingGroup ?? productGroups[0]}
              showImage={false}
              onJoin={() => {
                if (!useSupabase || authUser) {
                  navigate(`/prodotto/${product.id}?group=${(existingGroup ?? productGroups[0]).group.id}`);
                  return;
                }
                handleRequireLogin();
              }}
            />
          </div>
        )}

        {error && <Alert type="error" message={error} />}
        {success && <Alert type="success" message={success} />}

        {!success && (!useSupabase || authUser) && (
          <form onSubmit={handleSubmit} className="bg-white/90 rounded-[1.75rem] border border-brand-100 p-6 space-y-4 shadow-[0_16px_50px_rgba(91,33,182,0.08)]">
            <p className="text-sm text-brand-600">
              Inserisci il tuo nome per partecipare. L'email serve solo per l'accesso e per gli aggiornamenti sul gruppo.
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
                Email account
              </label>
              {useSupabase ? (
                <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-700">
                  {authUser?.email ?? 'Email account non disponibile'}
                </div>
              ) : (
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
                  placeholder="tua@email.it"
                  required
                />
              )}
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 rounded-2xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-semibold transition-all shadow-sm"
            >
              {submitting ? 'Invio...' : groupId ? 'Unisciti al gruppo' : 'Partecipa ora'}
            </button>
          </form>
        )}

        {imageOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-6" onClick={() => setImageOpen(false)}>
            <button
              type="button"
              onClick={() => setImageOpen(false)}
              className="absolute right-4 top-4 rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-brand-800 shadow-lg"
            >
              Chiudi
            </button>
            <div
              className="max-h-[88vh] max-w-[92vw] overflow-hidden rounded-[1.75rem] bg-white shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              {product.image_url ? (
                <img src={product.image_url} alt={product.name} className="max-h-[88vh] w-full object-contain" />
              ) : (
                <div className="flex h-[60vh] w-[80vw] items-center justify-center text-7xl">🎁</div>
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
