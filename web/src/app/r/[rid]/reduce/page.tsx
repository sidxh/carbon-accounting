"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { useRequest } from "@/components/request-context";
import { PageTitle } from "@/components/ui/bits";
import { ReducePlanner } from "@/components/reduce-planner";

// The reduction plan as its own page. The inventory opens the same planner in a
// dialog; this route stays for direct links.
export default function ReducePage() {
  const t = useTranslations("reduce");
  const { request } = useRequest();
  return (
    <div className="space-y-6 pb-16">
      <PageTitle title={t("title")} lede={t("lede")} />
      <ReducePlanner />
      <Link className="btn btn-secondary btn-sm gap-1.5" href={`/r/${request.id}/inventory`}><ArrowRight className="size-3.5 rotate-180" aria-hidden />{t("toInventory")}</Link>
    </div>
  );
}
