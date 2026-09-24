"use client";

import { useParams, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CircleAlert } from "lucide-react";
import { api, ApiError, type Progress, type ReportingPeriod, type RequestView, type SupplierProfile } from "@/lib/api";
import { SkeletonList } from "./ui/bits";

export interface RequestCtx {
  uid: string;
  profile: SupplierProfile;
  view: RequestView;
  request: RequestView["request"];
  period: ReportingPeriod;
  progress: Progress;
  /** Re-read the request so the stepper unlocks after an upload, a finished chat or a compute. */
  reload: () => Promise<void>;
}

const Ctx = createContext<RequestCtx | null>(null);

/**
 * Loads the request named in the route once and hands request, period,
 * profile and progress to every page under /r/[rid]. Pages call `reload()`
 * when they change something the gating depends on.
 */
export function RequestProvider({ uid, profile, children }: { uid: string; profile: SupplierProfile; children: React.ReactNode }) {
  const { rid } = useParams<{ rid: string }>();
  const router = useRouter();
  const t = useTranslations("common");
  const [view, setView] = useState<RequestView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const v = await api.getRequest(uid, rid);
      setView(v);
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        router.replace("/home");
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [uid, rid, router]);

  useEffect(() => { reload(); }, [reload]);

  const value = useMemo<RequestCtx | null>(() => {
    if (!view || !view.period) return null;
    return { uid, profile, view, request: view.request, period: view.period, progress: view.progress, reload };
  }, [uid, profile, view, reload]);

  if (error) {
    return (
      <div className="card flex items-start gap-3 p-5 text-sm">
        <CircleAlert className="size-5 shrink-0 text-danger" aria-hidden />
        <div className="flex-1"><p className="font-medium">{t("error")}</p><p className="mt-1 font-mono text-xs text-muted">{error}</p></div>
        <button className="btn btn-secondary btn-sm" onClick={reload}>{t("retry")}</button>
      </div>
    );
  }
  if (!value) return <SkeletonList rows={3} />;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRequest(): RequestCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRequest outside RequestProvider");
  return v;
}
