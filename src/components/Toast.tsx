import { useEffect, useState } from "react";
import "./Toast.css";

/** A message plus a nonce, so the same words twice still re-triggers the
 *  fade — the prop changing is what the effect below reacts to. */
export interface ToastState {
  message: string;
  nonce: number;
}

/**
 * A transient confirmation of what just happened — started, logged, paused —
 * near the bottom of the app, then gone. One at a time: a new message
 * replaces whatever was showing, it never queues.
 */
export function Toast({ toast }: { toast: ToastState | null }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (toast === null) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  if (toast === null) return null;

  return (
    <div className={`toast${visible ? " is-visible" : ""}`} role="status" aria-live="polite">
      {toast.message}
    </div>
  );
}
