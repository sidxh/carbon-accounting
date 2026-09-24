"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api, ApiError, type SupplierProfile } from "@/lib/api";
import { useAuth } from "./auth-provider";

/**
 * Gate for every page after sign-in. Sends anonymous visitors to /sign-in and
 * signed-in users without a profile to /setup. Hands the profile down so pages
 * do not each refetch it.
 */
export function RequireAuth({ children }: { children: (p: SupplierProfile | null, uid: string) => React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const path = usePathname();
  const t = useTranslations("common");
  const [profile, setProfile] = useState<SupplierProfile | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/sign-in");
      return;
    }
    setError(null);
    api
      .getSupplier(user.uid)
      .then(setProfile)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 404) {
          setProfile(null);
          if (path !== "/setup") router.replace("/setup");
          return;
        }
        // Anything else — agent down, 500, network — must be visible, not an
        // endless spinner.
        setError(e instanceof Error ? e.message : String(e));
      });
  }, [user, loading, router, path, attempt]);

  if (error) {
    return (
      <div className="card m-4 p-5 text-sm">
        <p className="text-red-700">{t("error")}</p>
        <p className="mt-1 font-mono text-xs text-[var(--muted)]">{error}</p>
        <button className="btn btn-secondary mt-3 px-4 py-1.5 text-sm" onClick={() => setAttempt((n) => n + 1)}>
          {t("retry")}
        </button>
      </div>
    );
  }
  if (loading || !user || profile === undefined) {
    return <p className="p-8 text-sm text-[var(--muted)]">{t("loading")}</p>;
  }
  if (profile === null && path !== "/setup") return null;
  return <>{children(profile, user.uid)}</>;
}
