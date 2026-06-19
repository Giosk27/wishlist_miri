import type { PublicGroupView } from '../types';

interface Props {
  view: PublicGroupView;
  compact?: boolean;
  showImage?: boolean;
  onJoin?: () => void;
}

export default function GroupCard({ view, compact, showImage = true, onJoin }: Props) {
  const { product, members, group, pricePerPerson } = view;
  const approvedNames = members.filter((m) => m.status === 'approved').map((m) => m.name);
  const compactView = !showImage;

  return (
    <div className={`overflow-hidden rounded-[1.5rem] border border-brand-100 bg-white/90 backdrop-blur-sm shadow-[0_14px_50px_rgba(91,33,182,0.08)] transition-transform hover:-translate-y-0.5 hover:shadow-[0_18px_60px_rgba(91,33,182,0.12)] ${compact ? '' : 'flex flex-col'}`}>
      {showImage ? (
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
      ) : null}
      <div className={`p-4 flex flex-col gap-2 flex-1 ${compactView ? 'pt-4' : ''}`}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-brand-900">
            {group.purchased ? 'Regalo comprato' : 'Regalo in attesa'}
          </p>
          <span
            className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
              group.purchased ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
            }`}
          >
            {group.purchased ? 'Comprato ✓' : 'In attesa'}
          </span>
        </div>

        {pricePerPerson !== null && approvedNames.length > 0 && (
          <p className="text-sm text-brand-500">
            ~€{pricePerPerson.toFixed(2)} a persona ({approvedNames.length} {approvedNames.length === 1 ? 'persona' : 'persone'})
          </p>
        )}

        <div className="mt-1">
          <p className="text-xs uppercase tracking-wide text-brand-400 font-semibold mb-1.5">Partecipanti</p>
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
