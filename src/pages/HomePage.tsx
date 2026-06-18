import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import ProductSection from '../components/ProductSection';
import Alert from '../components/Alert';
import { getProducts, getPublicGroups, useSupabase } from '../lib/api';
import type { Product, PublicGroupView } from '../types';

export default function HomePage() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [groups, setGroups] = useState<PublicGroupView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([getProducts(), getPublicGroups()])
      .then(([p, g]) => {
        setProducts(p);
        setGroups(g);
      })
      .catch(() => setError('Errore nel caricamento della wishlist.'))
      .finally(() => setLoading(false));
  }, []);

  const goJoin = (productId: string, groupId?: string) => {
    const params = new URLSearchParams({ product: productId });
    if (groupId) params.set('group', groupId);
    navigate(`/partecipa?${params.toString()}`);
  };

  return (
    <Layout>
      <div className="space-y-10">
        <div className="relative overflow-hidden rounded-[2rem] border border-brand-100 bg-white/85 backdrop-blur-sm px-6 py-10 sm:px-10 shadow-[0_20px_70px_rgba(91,33,182,0.08)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(167,139,250,0.18),_transparent_35%),radial-gradient(circle_at_bottom_left,_rgba(237,233,254,0.85),_transparent_40%)]" />
          <div className="relative text-center max-w-2xl mx-auto space-y-4">
            <span className="inline-flex items-center rounded-full border border-brand-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">
              Wishlist condivisa
            </span>
            <h1 className="font-display text-4xl sm:text-5xl font-bold text-brand-900 tracking-tight">
              Scegli il tuo regalo di gruppo
            </h1>
            <p className="text-brand-700/80 text-lg">
              Ogni partecipante può unirsi a un solo gruppo. Scegli un regalo, inserisci nome e email, e contribuisci alla tua parte.
            </p>
            <div className="flex flex-wrap justify-center gap-2 pt-2 text-sm">
              <span className="rounded-full bg-brand-100 px-3 py-1 text-brand-800">Foto prodotti</span>
              <span className="rounded-full bg-white px-3 py-1 text-brand-700 border border-brand-100">Gruppi visibili</span>
            </div>
          </div>
        </div>

        {!useSupabase && (
          <Alert
            type="info"
            message="Modalità demo locale attiva (localStorage). Per la produzione su GitHub Pages configura Supabase — vedi README."
          />
        )}

        {error && <Alert type="error" message={error} />}

        {loading ? (
          <div className="text-center py-20 text-brand-500">Caricamento...</div>
        ) : products.length === 0 ? (
          <div className="text-center py-20 bg-white/85 rounded-[1.75rem] border border-brand-100 shadow-sm">
            <p className="text-brand-600 text-lg">La wishlist è vuota.</p>
            <p className="text-brand-400 text-sm mt-2">L'admin può aggiungere prodotti dalla pagina admin.</p>
          </div>
        ) : (
          <div className="space-y-14">
            {products.map((product) => (
              <ProductSection
                key={product.id}
                product={product}
                groups={groups}
                onJoinNew={() => goJoin(product.id)}
                onJoinExisting={(groupId) => goJoin(product.id, groupId)}
              />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
