import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getAppNotifications } from '../lib/api';
import type { AppNotification } from '../types';

const links = [
  { to: '/', label: 'Wishlist' },
  { to: '/il-mio-gruppo', label: 'Il mio gruppo' },
];

const NOTIFICATION_KEY = 'wishlist_seen_app_notifications';

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [permissionState, setPermissionState] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default',
  );
  const [notificationHint, setNotificationHint] = useState('');

  const isIos =
    typeof navigator !== 'undefined' &&
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !('MSStream' in window);
  const isStandalone =
    typeof window !== 'undefined' &&
    window.matchMedia('(display-mode: standalone)').matches;

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const items = await getAppNotifications('all');
        if (!cancelled) setNotifications(items.slice(0, 3));
      } catch {
        if (!cancelled) setNotifications([]);
      }
    };

    void refresh();
    const interval = window.setInterval(refresh, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [location.pathname]);

  useEffect(() => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    let seen: Set<string>;
    try {
      seen = new Set<string>(JSON.parse(localStorage.getItem(NOTIFICATION_KEY) || '[]'));
    } catch {
      seen = new Set<string>();
    }
    for (const notification of notifications) {
      if (!seen.has(notification.id)) {
        try {
          new Notification(notification.title, { body: notification.body });
        } catch {
          // Ignore browser limits or unsupported cases.
        }
        seen.add(notification.id);
      }
    }
    localStorage.setItem(NOTIFICATION_KEY, JSON.stringify(Array.from(seen)));
  }, [notifications]);

  const enableNotifications = async () => {
    setNotificationHint('');
    if (typeof Notification === 'undefined') {
      setNotificationHint(
        isIos
          ? 'Su iPhone le notifiche web funzionano meglio dopo aver aggiunto il sito alla schermata Home.'
          : 'Il browser non supporta le notifiche web in questa modalità.',
      );
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      setPermissionState(permission);
      if (permission === 'granted') {
        setNotificationHint('Notifiche attivate correttamente.');
      } else if (permission === 'denied') {
        setNotificationHint('Le notifiche sono state bloccate dal browser.');
      } else if (isIos && !isStandalone) {
        setNotificationHint('Su iPhone prova ad aprire il sito dalla schermata Home: lì le notifiche sono molto più affidabili.');
      }
    } catch {
      setNotificationHint(
        isIos
          ? 'Su iPhone prova ad aprire il sito dalla schermata Home e poi riattiva le notifiche.'
          : 'Non sono riuscito ad aprire il prompt notifiche del browser.',
      );
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-brand-50 via-white to-brand-100/50">
      <div className="pointer-events-none absolute -top-24 left-[-6rem] h-72 w-72 rounded-full bg-brand-200/30 blur-3xl" />
      <div className="pointer-events-none absolute top-40 right-[-5rem] h-80 w-80 rounded-full bg-fuchsia-200/20 blur-3xl" />
      <header className="sticky top-0 z-50 border-b border-brand-100/80 bg-white/75 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link to="/" className="flex items-center gap-2 group self-start">
            <span className="text-2xl" aria-hidden>
              🎁
            </span>
            <span className="font-display text-xl font-semibold text-brand-800 group-hover:text-brand-600 transition-colors">
              Wishlist - Regalo di Gruppo
            </span>
          </Link>
          <nav className="flex flex-wrap items-center gap-2 sm:justify-end">
            {links.map(({ to, label }) => {
              const active = location.pathname === to;
              return (
                <Link
                  key={to}
                  to={to}
                  className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                    active
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'text-brand-700 hover:bg-brand-100'
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="relative z-10 max-w-6xl mx-auto px-4 py-8 space-y-6">
        <section className="rounded-[1.5rem] border border-brand-100 bg-white/90 backdrop-blur-sm p-4 shadow-[0_14px_40px_rgba(91,33,182,0.08)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-500">Notifiche web</p>
                <h2 className="font-display text-xl font-semibold text-brand-900">Ultimi aggiornamenti</h2>
              </div>
              {permissionState !== 'granted' && (
                <div className="flex flex-col gap-2">
                  <button
                    onClick={enableNotifications}
                    className="self-start rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                  >
                    Attiva notifiche
                  </button>
                  {notificationHint && <p className="text-sm text-brand-700">{notificationHint}</p>}
                </div>
              )}
            </div>
            {isIos && !isStandalone && permissionState !== 'granted' && (
              <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Su iPhone apri il sito in Safari e aggiungilo alla schermata Home, poi riaprilo da lì per usare al meglio le notifiche.
              </p>
            )}
            <div className="mt-4 grid gap-3">
              {notifications.length > 0 ? (
                notifications.map((notification) => (
                  <article key={notification.id} className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-brand-900">{notification.title}</h3>
                        <p className="mt-1 text-sm text-brand-700 whitespace-pre-line">{notification.body}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-brand-500">
                        {notification.target_scope === 'all' ? 'Tutti' : 'Prodotto'}
                      </span>
                    </div>
                  </article>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-brand-200 bg-brand-50/40 p-4 text-sm text-brand-700">
                  Nessuna notifica ancora. Le notifiche app compaiono quando un admin invia un annuncio con il canale app attivo.
                </div>
              )}
            </div>
          </section>
        {children}
      </main>
      <footer className="relative z-10 border-t border-brand-100/80 mt-auto py-6 text-center text-sm text-brand-600/70 bg-white/40 backdrop-blur-sm">
        Regalo di gruppo - Made by Gio
      </footer>
    </div>
  );
}
