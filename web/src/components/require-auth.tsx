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

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/sign-in");
      return;
    }
    api
      .getSupplier(user.uid)
      .then(setProfile)
      .catch((e: ApiError) => {
        if (e.status === 404) {
          setProfile(null);
          if (path !== "/setup") router.replace("/setup");
        }
      });
  }, [user, loading, router, path]);

  if (loading || !user || profile === undefined) {
    return <p className="p-8 text-sm text-[var(--muted)]">{t("loading")}</p>;
  }
  if (profile === null && path !== "/setup") return null;
  return <>{children(profile, user.uid)}</>;
}
