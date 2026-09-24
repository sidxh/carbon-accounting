"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { Shell } from "@/components/shell";

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const t = useTranslations();
  useEffect(() => {
    if (!loading) router.replace(user ? "/documents" : "/sign-in");
  }, [user, loading, router]);
  return (
    <Shell showSteps={false}>
      <p className="text-[var(--muted)]">{t("app.tagline")}</p>
    </Shell>
  );
}
