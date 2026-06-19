import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import Alert from '../components/Alert';
import GroupCard from '../components/GroupCard';
import {
  loginMember,
  getMemberGroupView,
  setPurchased,
  changeGroup,
  leaveGroup,
  getProducts,
  getPublicGroups,
  getMemberForAuthUser,
  useSupabase,
} from '../lib/api';
import {
  getMemberSession,
  saveMemberSession,
  clearMemberSession,
  isValidEmail,
} from '../lib/security';
import { getCurrentAuthUser, signInWithPassword, signOut, signUpWithPassword } from '../lib/auth';
import type { PublicGroupView, Product } from '../types';

export default function MyGroupPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTarget = searchParams.get('redirect');
  const safeRedirectTarget = redirectTarget && redirectTarget.startsWith('/') ? redirectTarget : '';
  const [session, setSession] = useState(getMemberSession());
  const [emailInput, setEmailInput] = useState('');
  const [authUser, setAuthUser] = useState<{ id: string; email: string | null } | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authInfo, setAuthInfo] = useState('');
  const [view, setView] = useState<PublicGroupView | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [allGroups, setAllGroups] = useState<PublicGroupView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showChangeGroup, setShowChangeGroup] = useState(false);
  const [changing, setChanging] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!useSupabase) return;
    getCurrentAuthUser().then(setAuthUser).catch(() => setAuthUser(null));
  }, []);

  const loadView = async (memberId: string) => {
    setLoading(true);
    try {
      const v = await getMemberGroupView(memberId);
      setView(v);
    } catch {
      setError('Errore nel caricamento del gruppo.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!useSupabase || !authUser) return;
    setLoading(true);
    getMemberForAuthUser(authUser.id)
      .then((member) => {
        if (!member) {
          setSession(null);
          setView(null);
          setAuthInfo('Account creato. Ora unisciti a un gruppo dalla wishlist per vedere la tua area utente.');
          return;
        }
        const newSession = {
          memberId: member.id,
          groupId: member.group_id,
          name: member.name,
          email: member.email,
          sessionToken: member.session_token,
        };
        saveMemberSession(newSession);
        setSession(newSession);
      })
      .catch(() => setAuthInfo('Errore caricamento utente.'))
      .finally(() => setLoading(false));
  }, [authUser]);

  useEffect(() => {
    if (session) {
      loadView(session.memberId);
    }
  }, [session]);

  useEffect(() => {
    if (showChangeGroup) {
      Promise.all([getProducts(), getPublicGroups()]).then(([p, g]) => {
        setProducts(p);
        setAllGroups(g);
      });
    }
  }, [showChangeGroup]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!isValidEmail(emailInput)) {
      setError('Inserisci un email valida.');
      return;
    }
    setLoading(true);
    try {
      const member = await loginMember(emailInput.trim().toLowerCase());
      if (!member) {
        setError('Email non trovata.');
        return;
      }
      const newSession = {
        memberId: member.id,
        groupId: member.group_id,
        name: member.name,
        email: member.email,
        sessionToken: member.session_token,
      };
      saveMemberSession(newSession);
      setSession(newSession);
    } catch {
      setError('Errore durante l\'accesso.');
    } finally {
      setLoading(false);
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthInfo('');
    setError('');
    if (!isValidEmail(authEmail) || authPassword.length < 8) {
      setAuthInfo('Inserisci email valida e password di almeno 8 caratteri.');
      return;
    }
    setAuthLoading(true);
    try {
      const token = authMode === 'login'
        ? await signInWithPassword(authEmail.trim().toLowerCase(), authPassword)
        : await signUpWithPassword(authEmail.trim().toLowerCase(), authPassword);
      if (!token) {
        setAuthInfo(
          authMode === 'login'
            ? 'Login non riuscito.'
            : 'Controlla la tua email per confermare l’account e poi torna qui per accedere.',
        );
      } else {
        const currentUser = await getCurrentAuthUser();
        setAuthUser(currentUser);
        if (currentUser && safeRedirectTarget) {
          navigate(safeRedirectTarget, { replace: true });
        }
      }
    } catch {
      setAuthInfo('Errore durante l\'accesso.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleTogglePurchased = async () => {
    if (!session || !view) return;
    setError('');
    try {
      const ok = await setPurchased(view.group.id, session.sessionToken, !view.group.purchased);
      if (!ok) {
        setError('Non autorizzato ad aggiornare lo stato.');
        return;
      }
      setView({
        ...view,
        group: { ...view.group, purchased: !view.group.purchased },
      });
      setSuccess(view.group.purchased ? 'Segnato come non comprato.' : 'Segnato come comprato!');
    } catch {
      setError('Errore aggiornamento stato.');
    }
  };

  const handleChangeGroup = async (productId: string, newGroupId?: string) => {
    if (!session) return;
    setChanging(true);
    setError('');
    try {
      const result = await changeGroup(session.memberId, newGroupId ?? null, productId);
      const newSession = {
        memberId: result.member.id,
        groupId: result.member.group_id,
        name: result.member.name,
        email: result.member.email,
        sessionToken: result.member.session_token,
      };
      saveMemberSession(newSession);
      setSession(newSession);
      setShowChangeGroup(false);
      const warning = result.warning ? ` ${result.warning}` : '';
      setSuccess(`Gruppo cambiato! Nuovo importo: €${result.pricePerPerson.toFixed(2)} a persona.${warning}`);
      await loadView(result.member.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore cambio gruppo');
    } finally {
      setChanging(false);
    }
  };

  const handleLeaveGroup = async () => {
    if (!session) return;
    if (!confirm('Vuoi davvero abbandonare questo gruppo?')) return;
    setLeaving(true);
    setError('');
    try {
      const ok = await leaveGroup(session.memberId);
      if (!ok) {
        setError('Non è stato possibile abbandonare il gruppo.');
        return;
      }
      clearMemberSession();
      setSession(null);
      setView(null);
      setShowChangeGroup(false);
      setSuccess('');
    } catch {
      setError('Errore durante l\'uscita dal gruppo.');
    } finally {
      setLeaving(false);
    }
  };

  const handleLogout = () => {
    if (useSupabase) {
      signOut().catch(() => undefined);
    }
    clearMemberSession();
    setSession(null);
    setView(null);
    setEmailInput('');
    setAuthUser(null);
  };

  if (useSupabase && !authUser) {
    return (
      <Layout>
        <div className="max-w-md mx-auto space-y-6">
          <div className="text-center space-y-2 rounded-[1.75rem] border border-brand-100 bg-white/85 backdrop-blur-sm p-6 shadow-[0_16px_50px_rgba(91,33,182,0.08)]">
            <h1 className="font-display text-3xl font-bold text-brand-900">Area utente</h1>
            <p className="text-brand-600">Accedi o registrati per vedere il tuo gruppo e gestire i tuoi dati.</p>
          </div>
          {authInfo && <Alert type="info" message={authInfo} />}
          <form onSubmit={handleAuthSubmit} className="bg-white/90 rounded-[1.75rem] border border-brand-100 p-6 space-y-4 shadow-[0_16px_50px_rgba(91,33,182,0.08)]">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAuthMode('login')}
                className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold ${authMode === 'login' ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-700'}`}
              >
                Accedi
              </button>
              <button
                type="button"
                onClick={() => setAuthMode('signup')}
                className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold ${authMode === 'signup' ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-700'}`}
              >
                Registrati
              </button>
            </div>
            <div>
              <label htmlFor="auth-email" className="block text-sm font-medium text-brand-800 mb-1">
                Email
              </label>
              <input
                id="auth-email"
                type="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
                placeholder="tua@email.it"
                required
              />
            </div>
            <div>
              <label htmlFor="auth-password" className="block text-sm font-medium text-brand-800 mb-1">
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
                placeholder="Minimo 8 caratteri"
                required
              />
            </div>
            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-3 rounded-2xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-semibold shadow-sm"
            >
              {authLoading ? 'Invio...' : authMode === 'login' ? 'Accedi' : 'Crea account'}
            </button>
          </form>
          <p className="text-center text-sm text-brand-500">
            Dopo la registrazione, torna qui e usa la tua area utente.
          </p>
          <p className="text-center text-sm text-brand-500">
            <Link to="/" className="text-brand-700 font-medium hover:underline">
              Torna alla wishlist
            </Link>
          </p>
        </div>
      </Layout>
    );
  }

  if (useSupabase && authUser && !session) {
    return (
      <Layout>
        <div className="max-w-md mx-auto space-y-6">
          <div className="text-center space-y-2 rounded-[1.75rem] border border-brand-100 bg-white/85 backdrop-blur-sm p-6 shadow-[0_16px_50px_rgba(91,33,182,0.08)]">
            <h1 className="font-display text-3xl font-bold text-brand-900">Area utente</h1>
            <p className="text-brand-600">Hai effettuato l'accesso. Ora scegli un regalo dalla wishlist per collegare il tuo account a un gruppo.</p>
          </div>
          {authInfo && <Alert type="info" message={authInfo} />}
          <div className="rounded-[1.75rem] border border-brand-100 bg-white/90 p-6 shadow-[0_16px_50px_rgba(91,33,182,0.08)] space-y-4">
            <p className="text-sm text-brand-600">
              Email account: <strong>{authUser.email ?? 'n/d'}</strong>
            </p>
            <Link to="/" className="inline-flex w-full justify-center rounded-2xl bg-brand-600 px-4 py-3 font-semibold text-white hover:bg-brand-700">
              Vai alla wishlist
            </Link>
            <button
              onClick={handleLogout}
              className="w-full rounded-2xl border border-brand-200 px-4 py-3 font-semibold text-brand-700 hover:bg-brand-50"
            >
              Esci
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  if (!session) {
    return (
      <Layout>
        <div className="max-w-md mx-auto space-y-6">
          <div className="text-center space-y-2 rounded-[1.75rem] border border-brand-100 bg-white/85 backdrop-blur-sm p-6 shadow-[0_16px_50px_rgba(91,33,182,0.08)]">
            <h1 className="font-display text-3xl font-bold text-brand-900">Il mio gruppo</h1>
            <p className="text-brand-600">Accedi con la tua email per gestire il tuo gruppo regalo.</p>
          </div>
          {error && <Alert type="error" message={error} />}
          <form onSubmit={handleLogin} className="bg-white/90 rounded-[1.75rem] border border-brand-100 p-6 space-y-4 shadow-[0_16px_50px_rgba(91,33,182,0.08)]">
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-brand-800 mb-1">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
                placeholder="tua@email.it"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-2xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-semibold shadow-sm"
            >
              {loading ? 'Accesso...' : 'Accedi'}
            </button>
          </form>
          <p className="text-center text-sm text-brand-500">
            Non sei ancora iscritto?{' '}
            <Link to="/" className="text-brand-700 font-medium hover:underline">
              Scegli un regalo
            </Link>
          </p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4 rounded-[1.75rem] border border-brand-100 bg-white/85 backdrop-blur-sm p-6 shadow-[0_16px_50px_rgba(91,33,182,0.08)]">
          <div>
            <h1 className="font-display text-3xl font-bold text-brand-900">Ciao, {session.name}!</h1>
            <p className="text-brand-600 text-sm mt-1">{session.email}</p>
          </div>
          <button onClick={handleLogout} className="text-sm text-brand-500 hover:text-brand-700">
            Esci
          </button>
        </div>

        {error && <Alert type="error" message={error} onClose={() => setError('')} />}
        {success && <Alert type="success" message={success} onClose={() => setSuccess('')} />}

        {loading && !view ? (
          <div className="text-center py-10 text-brand-500">Caricamento...</div>
        ) : view ? (
          <>
            <GroupCard view={view} />
            <div className="bg-white/90 rounded-[1.75rem] border border-brand-100 p-6 space-y-4 shadow-[0_16px_50px_rgba(91,33,182,0.08)]">
              <h2 className="font-semibold text-brand-900">Gestione regalo</h2>
              {view.pricePerPerson !== null && (
                <p className="text-brand-700">
                  Il tuo contributo: <strong>€{view.pricePerPerson.toFixed(2)}</strong>
                </p>
              )}
              <button
                onClick={handleTogglePurchased}
                className={`w-full py-3 rounded-2xl font-semibold transition-all shadow-sm ${
                  view.group.purchased
                    ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                    : 'bg-emerald-600 text-white hover:bg-emerald-700'
                }`}
              >
                {view.group.purchased ? 'Segna come non ancora comprato' : 'Segna come comprato ✓'}
              </button>
              <button
                onClick={handleLeaveGroup}
                disabled={leaving}
                className="w-full py-3 rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 font-semibold hover:bg-rose-100 disabled:opacity-50"
              >
                {leaving ? 'Uscita...' : 'Abbandona gruppo'}
              </button>
            </div>
          </>
        ) : null}

        <div className="bg-white/90 rounded-[1.75rem] border border-brand-100 p-6 shadow-[0_16px_50px_rgba(91,33,182,0.08)]">
          <button
            onClick={() => setShowChangeGroup(!showChangeGroup)}
            className="text-brand-700 font-semibold hover:text-brand-900"
          >
            {showChangeGroup ? '✕ Annulla cambio gruppo' : '↻ Cambia gruppo regalo'}
          </button>
          {showChangeGroup && (
            <div className="mt-4 space-y-6">
              <p className="text-sm text-brand-600">Puoi partecipare a un solo gruppo. Scegli un nuovo regalo:</p>
              {products.map((product) => {
                const productGroups = allGroups.filter((g) => g.product.id === product.id);
                return (
                  <div key={product.id} className="border-t border-brand-100 pt-4 space-y-2">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-brand-100 border border-brand-200">
                        {product.image_url ? (
                          <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center text-lg">🎁</div>
                        )}
                      </div>
                      <p className="font-medium text-brand-900">
                        {product.name} — €{product.price.toFixed(2)}
                      </p>
                    </div>
                    <button
                      disabled={changing}
                      onClick={() => handleChangeGroup(product.id)}
                      className="text-sm px-3 py-1.5 rounded-xl border border-brand-200 bg-white text-brand-700 hover:bg-brand-50 disabled:opacity-50"
                    >
                      Crea nuovo gruppo
                    </button>
                    {productGroups.map((g) => (
                      <button
                        key={g.group.id}
                        disabled={changing || g.group.id === session.groupId}
                        onClick={() => handleChangeGroup(product.id, g.group.id)}
                        className="block text-sm px-3 py-1.5 rounded-xl border border-brand-200 text-brand-600 hover:bg-brand-50 disabled:opacity-50 ml-2"
                      >
                        Unisciti: {g.members.filter((m) => m.status === 'approved').map((m) => m.name).join(', ') || 'gruppo vuoto'}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
