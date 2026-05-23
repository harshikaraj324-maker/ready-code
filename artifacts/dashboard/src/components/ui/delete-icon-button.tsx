import { useState } from "react";
import { Trash2 } from "lucide-react";

type Props = {
  onConfirm: () => void | Promise<void>;
  confirmText?: string;
  size?: number;
  title?: string;
};

export function DeleteIconButton({
  onConfirm,
  confirmText = "Delete this item?",
  size = 22,
  title = "Delete",
}: Props) {
  const [hover, setHover] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    try { await onConfirm(); }
    finally { setBusy(false); }
  }

  const color = "#ef4444";
  const iconSize = Math.round(size * 0.5);

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      disabled={busy}
      title={title}
      aria-label={title}
      style={{
        width: size, height: size, minWidth: size,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: hover ? `${color}22` : "transparent",
        border: `1px solid ${hover ? `${color}66` : `${color}33`}`,
        borderRadius: 8, padding: 0,
        color: hover ? color : `${color}cc`,
        cursor: busy ? "wait" : "pointer",
        transition: "background 160ms ease, border-color 160ms ease, color 160ms ease",
        flexShrink: 0,
        opacity: busy ? 0.5 : 1,
      }}
    >
      <Trash2 size={iconSize} strokeWidth={2.2} />
    </button>
  );
}
