"use client";

import { usePathname } from "next/navigation";
import { RequireAuth } from "@/components/require-auth";
import { RequestProvider, useRequest } from "@/components/request-context";
import { RequestHeader, Shell, Stepper } from "@/components/shell";

function Frame({ children }: { children: React.ReactNode }) {
  const { request, period, progress, view } = useRequest();
  const path = usePathname();
  const wide = path.endsWith("/inventory");
  return (
    <Shell
      wide={wide}
      header={<RequestHeader customer={request.customer_name} periodLabel={period.label} sharedWith={view.shared_with} />}
      sub={<Stepper rid={request.id} progress={progress} meta={{ documents: progress.documents ? String(progress.documents) : undefined }} />}
    >
      {children}
    </Shell>
  );
}

/** Every page under /r/[rid] shares the request, the period and the gated stepper. */
export default function RequestLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      {(profile, uid) =>
        profile ? (
          <RequestProvider uid={uid} profile={profile}>
            <Frame>{children}</Frame>
          </RequestProvider>
        ) : null
      }
    </RequireAuth>
  );
}
