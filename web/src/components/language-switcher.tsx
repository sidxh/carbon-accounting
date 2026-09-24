"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Globe } from "lucide-react";

const NAMES: Record<string, string> = { en: "English", vi: "Tiếng Việt", ja: "日本語" };

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations();
  return (
    <label className={`relative inline-flex items-center ${className}`}>
      <span className="sr-only">{t("app.language")}</span>
      <Globe className="pointer-events-none absolute left-3 size-4 text-muted" aria-hidden />
      <select
        aria-label={t("app.language")}
        className="input !min-h-9 w-auto appearance-none rounded-full !py-1.5 !pl-9 !pr-8 text-sm"
        value={locale}
        onChange={(e) => {
          document.cookie = `NEXT_LOCALE=${e.target.value}; path=/; max-age=31536000; samesite=lax`;
          router.refresh();
        }}
      >
        {Object.entries(NAMES).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-3 text-[10px] text-muted" aria-hidden>▼</span>
    </label>
  );
}
