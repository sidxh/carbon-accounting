"use client";

import { useCallback } from "react";
import { Toaster, toast as sonner } from "sonner";
import { CheckCircle2, CircleAlert, Info } from "lucide-react";

type Tone = "ok" | "attention" | "danger" | "info";

/** Sonner, styled with the app tokens. Mounted once in the root layout. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Toaster
        position="bottom-center"
        offset={{ bottom: "max(16px, env(safe-area-inset-bottom))" }}
        gap={8}
        visibleToasts={3}
        icons={{
          success: <CheckCircle2 className="size-4 text-signal" aria-hidden />,
          warning: <CircleAlert className="size-4 text-attention" aria-hidden />,
          error: <CircleAlert className="size-4 text-danger" aria-hidden />,
          info: <Info className="size-4 text-muted" aria-hidden />,
        }}
        toastOptions={{
          unstyled: true,
          classNames: {
            toast: "card z-toast flex w-full max-w-md items-center gap-3 px-4 py-3 text-sm text-ink shadow-[var(--shadow-float)]",
            title: "font-medium",
            description: "text-muted",
            closeButton: "btn btn-ghost btn-icon !min-h-8 !min-w-8",
          },
        }}
        closeButton
      />
    </>
  );
}

/** Same call shape as before: toast(text, tone). */
export function useToast() {
  return useCallback((text: string, tone: Tone = "ok") => {
    const opts = { duration: tone === "danger" ? 7000 : 3500 };
    if (tone === "ok") sonner.success(text, opts);
    else if (tone === "attention") sonner.warning(text, opts);
    else if (tone === "danger") sonner.error(text, opts);
    else sonner.info(text, opts);
  }, []);
}
