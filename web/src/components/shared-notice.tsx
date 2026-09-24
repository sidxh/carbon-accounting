"use client";

import { useTranslations } from "next-intl";
import { Users } from "lucide-react";

/** Bills, questions and the inventory belong to the year, not the request; say so when another customer also uses it. */
export function SharedNotice({ sharedWith, periodLabel }: { sharedWith: string[]; periodLabel: string }) {
  const t = useTranslations("app");
  if (!sharedWith.length) return null;
  return (
    <p className="flex items-start gap-2 rounded-[var(--radius-sm)] bg-sunken px-3 py-2 text-xs text-muted">
      <Users className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{t("sharedNotice", { year: periodLabel, names: sharedWith.join(", ") })}</span>
    </p>
  );
}
