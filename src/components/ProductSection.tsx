import type { Product, PublicGroupView } from '../types';
import GroupCard from './GroupCard';

interface Props {
  product: Product;
  groups: PublicGroupView[];
  onJoinNew: () => void;
  onJoinExisting: (groupId: string) => void;
}

export default function ProductSection({ product, groups, onJoinNew, onJoinExisting }: Props) {
  const productGroups = groups.filter((g) => g.product.id === product.id);

  return (
    <section className="space-y-5 rounded-[1.75rem] border border-brand-100 bg-white/85 backdrop-blur-sm p-5 sm:p-6 shadow-[0_18px_60px_rgba(91,33,182,0.08)]">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-brand-100 to-white border border-brand-200 shadow-sm">
            {product.image_url ? (
              <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full flex items-center justify-center text-xl">🎁</div>
            )}
          </div>
          <div>
            <h2 className="font-display text-2xl font-semibold text-brand-900">{product.name}</h2>
            <p className="text-brand-600">€{product.price.toFixed(2)}</p>
          </div>
        </div>
        <button
          onClick={onJoinNew}
          className="shrink-0 px-5 py-2.5 rounded-2xl border border-brand-200 bg-white text-brand-700 hover:bg-brand-600 hover:text-white hover:border-brand-600 font-semibold text-sm transition-all shadow-sm"
        >
          + Crea nuovo gruppo
        </button>
      </div>

      {productGroups.length === 0 ? (
        <div className="bg-gradient-to-br from-brand-50/80 to-white border border-dashed border-brand-200 rounded-2xl p-8 text-center">
          <p className="text-brand-600">Nessun gruppo per questo regalo. Sii il primo!</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {productGroups.map((view) => (
            <GroupCard key={view.group.id} view={view} onJoin={() => onJoinExisting(view.group.id)} />
          ))}
        </div>
      )}
    </section>
  );
}
