import type { PublicGroupView } from '../types';

interface Props {
  view: PublicGroupView;
  compact?: boolean;
  onJoin?: () => void;
}

export default function GroupCard({ view, compact, onJoin }: Props) {
  const { product, members, group, pricePerPerson } = view;
  const approvedNames = members.filter((m) => m.status === 'approved').map((m) => m.name);

  return (
    <div className={`overflow-hidden rounded-[1.5rem] border border-brand-100 bg-white/90 backdrop-blur-sm shadow-[0_14px_50px_rgba(91,33,182,0.08)] transition-transform hover:-translate-y-0.5 hover:shadow-[0_18px_60px_rgba(91,33,182,0.12)] ${compact ? '' : 'flex flex-col'}`}>
      <div className={compact ? 'aspect-square relative' : 'aspect-[4/3] relative bg-gradient-to-br from-brand-50 to-white'}>
        {product.image_url ? (
          <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-5xl">🎁</div>
        )}
        {group.purchased && (
          <span className="absolute top-3 right-3 bg-emerald-600 text-white text-xs font-semibold px-2.5 py-1 rounded-full">
            Comprato ✓
          </span>
        )}
      </div>
      <div className="p-4 flex flex-col gap-2 flex-1">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-brand-100 to-white border border-brand-200 shadow-sm">
            {product.image_url ? (
              <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full flex items-center justify-center text-lg">🎁</div>
            )}
          </div>
          <div>
            <h3 className="font-display font-semibold text-brand-900">{product.name}</h3>
            <p className="text-brand-600 font-medium">€{product.price.toFixed(2)}</p>
          </div>
        </div>
        {pricePerPerson !== null && approvedNames.length > 0 && (
          <p className="text-sm text-brand-500 mt-0.5">
            ~€{pricePerPerson.toFixed(2)} a persona ({approvedNames.length} {approvedNames.length === 1 ? 'persona' : 'persone'})
          </p>
        )}
        {product.description && !compact && (
          <p className="text-sm text-brand-700/70 line-clamp-2">{product.description}</p>
        )}
        <div className="mt-auto pt-2">
          <p className="text-xs uppercase tracking-wide text-brand-400 font-semibold mb-1.5">Gruppo</p>
          {approvedNames.length > 0 ? (
            <p className="text-sm text-brand-800">{approvedNames.join(', ')}</p>
        ) : (
          <p className="text-sm text-brand-400 italic">Nessun partecipante ancora</p>
          )}
        </div>
        {onJoin && (
          <button
            onClick={onJoin}
            className="mt-3 w-full py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors"
          >
            Unisciti a questo gruppo
          </button>
        )}
      </div>
    </div>
  );
}
