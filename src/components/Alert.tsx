interface Props {
  type?: 'success' | 'error' | 'info';
  message: string;
  onClose?: () => void;
}

const styles = {
  success: 'bg-emerald-50/90 border-emerald-200 text-emerald-800',
  error: 'bg-rose-50/90 border-rose-200 text-rose-800',
  info: 'bg-brand-50/90 border-brand-200 text-brand-800',
};

export default function Alert({ type = 'info', message, onClose }: Props) {
  return (
    <div className={`border rounded-2xl px-4 py-3 flex items-start justify-between gap-3 shadow-sm ${styles[type]}`}>
      <p className="text-sm">{message}</p>
      {onClose && (
        <button onClick={onClose} className="text-lg leading-none opacity-60 hover:opacity-100" aria-label="Chiudi">
          ×
        </button>
      )}
    </div>
  );
}
