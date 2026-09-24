"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";

const NAMES: Record<string, string> = { en: "English", vi: "Tiếng Việt", ja: "日本語" };

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  return (
    <select
      aria-label="Language"
      className="rounded-full border border-[var(--line)] bg-white px-3 py-1 text-sm"
      value={locale}
      onChange={(e) => {
        document.cookie = `NEXT_LOCALE=${e.target.value}; path=/; max-age=31536000; samesite=lax`;
        router.refresh();
      }}
    >
      {Object.entries(NAMES).map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </select>
  );
}
