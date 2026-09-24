"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";

type Tone = "ok" | "attention" | "danger" | "info";
interface Toast { id: number; text: string; tone: Tone }

const Ctx = createContext<{ toast: (text: string, tone?: Tone) => void }>({ toast: () => {} });

/** Short, dismissable confirmations announced to screen readers via aria-live. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
  }, []);

  const toast = useCallback((text: string, tone: Tone = "ok") => {
    const id = ++seq.current;
    setItems((xs) => [...xs.slice(-2), { id, text, tone }]);
    timers.current.set(id, setTimeout(() => dismiss(id), tone === "danger" ? 7000 : 3500));
  }, [dismiss]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const value = useMemo(() => ({ toast }), [toast]);

  const Icon = { ok: CheckCircle2, attention: CircleAlert, danger: CircleAlert, info: Info };
  const color = { ok: "text-signal", attention: "text-attention", danger: "text-danger", info: "text-muted" };

  return (
    <Ctx.Provider value={value}>
      {children}
      <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed inset-x-0 bottom-4 z-[1000] flex flex-col items-center gap-2 px-4">
        <AnimatePresence>
          {items.map((t) => {
            const I = Icon[t.tone];
            return (
              <motion.div
                key={t.id}
                role="status"
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="card pointer-events-auto flex w-full max-w-md items-center gap-3 px-4 py-3 text-sm shadow-[var(--shadow-float)]"
              >
                <I className={`size-4 shrink-0 ${color[t.tone]}`} aria-hidden />
                <span className="flex-1">{t.text}</span>
                <button className="btn btn-ghost btn-icon !min-h-8 !min-w-8" onClick={() => dismiss(t.id)} aria-label="Dismiss">
                  <X className="size-4" aria-hidden />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx).toast;
}
