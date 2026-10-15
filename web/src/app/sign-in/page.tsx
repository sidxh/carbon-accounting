"use client";

import { signInWithEmailAndPassword } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Smokescape } from "@/components/landing/smokescape";
import { SiteNav } from "@/components/landing/site-nav";
import { firebaseAuth } from "@/lib/firebase";

type ErrorKey = "badCredentials" | "invalidEmail" | "tooMany" | "network" | "error";

/** Firebase error code to the message key in `signIn`. Wrong password and unknown user share one message
 * on purpose, so the page never says which accounts exist. */
function errorKey(code: string | undefined): ErrorKey {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/missing-password":
    case "auth/user-disabled":
      return "badCredentials";
    case "auth/invalid-email":
    case "auth/missing-email":
      return "invalidEmail";
    case "auth/too-many-requests":
    case "auth/quota-exceeded":
      return "tooMany";
    case "auth/network-request-failed":
      return "network";
    default:
      return "error";
  }
}

// Underline fields, as in the landing's light editorial style.
const field = "w-full rounded-none border-0 border-b border-dashed border-signal/40 bg-transparent px-3 py-2.5 font-mono text-base text-ink placeholder:text-faint focus:border-solid focus:border-signal focus-visible:outline-none";
const fieldLabel = "px-3 text-xs font-medium text-signal-ink";

export default function SignInPage() {
  const t = useTranslations("signIn");
  const router = useRouter();
  const { user, loading } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && user) router.replace("/home");
  }, [user, loading, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const address = email.trim();
    if (busy || !address || !password) return;
    setBusy(true);
    setError("");
    try {
      await signInWithEmailAndPassword(firebaseAuth(), address, password);
      router.replace("/home");
    } catch (err) {
      const code = (err as { code?: string }).code;
      console.error("sign-in failed:", code);
      setError(t(errorKey(code)));
      setBusy(false);
    }
  }

  return (
    <div className="relative min-h-dvh overflow-x-clip">
      <SiteNav signedIn={false} onLanding={false} />

      {/* The factory smoke turning into landscape, across the page behind the sign-in column. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 hidden h-dvh md:block">
        <Smokescape className="size-full" />
      </div>

      <main className="relative mx-auto grid min-h-dvh w-full max-w-6xl items-center gap-8 px-4 pb-10 pt-24 md:grid-cols-2 lg:pt-28">
        {/* Phones: the picture as a strip above the form. */}
        <div className="-mx-4 h-64 overflow-hidden md:hidden" aria-hidden>
          <Smokescape className="size-full" />
        </div>
        <div className="hidden md:block" aria-hidden />

        <motion.div
          initial={{ opacity: 0, transform: "translateY(10px)" }}
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
          className="relative mx-auto w-full max-w-md md:mr-0"
        >
          <p className="inline-flex items-center gap-2 rounded-full border border-signal/20 bg-signal-bg px-4 py-1.5 text-sm font-medium text-signal-ink">
            <span className="size-2 rounded-full bg-attention-strong" aria-hidden />{t("tag")}
          </p>
          <h1 className="font-display mt-5 text-[clamp(3rem,6vw,5rem)] leading-[0.92] text-ink">{t("big")}</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-pretty text-ink-soft">{t("lede")}</p>

          <div className="mt-7 rounded-[28px] border border-signal/15 bg-[linear-gradient(155deg,var(--raised)_0%,var(--raised)_45%,var(--signal-bg)_100%)] p-6 shadow-[var(--shadow-float)] sm:p-8">
            <p className="font-mono text-xs text-signal-ink">↳ {t("formLabel")}</p>

            <form onSubmit={submit} className="mt-6 space-y-6">
              <div>
                <label className={fieldLabel} htmlFor="email">{t("emailLabel")}</label>
                <input id="email" name="email" className={field} type="email" inputMode="email" autoComplete="username" placeholder={t("emailPlaceholder")} value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
              </div>
              <div>
                <label className={fieldLabel} htmlFor="password">{t("passwordLabel")}</label>
                <div className="relative">
                  <input id="password" name="password" className={`${field} pr-9`} type={show ? "text" : "password"} autoComplete="current-password" placeholder={t("passwordPlaceholder")} value={password} onChange={(e) => setPassword(e.target.value)} required />
                  <button
                    type="button"
                    className="absolute right-0 top-1/2 -translate-y-1/2 p-1.5 text-muted hover:text-ink"
                    aria-label={show ? t("hidePassword") : t("showPassword")}
                    aria-pressed={show}
                    onClick={() => setShow((v) => !v)}
                  >
                    {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                  </button>
                </div>
              </div>
              <button className="btn w-full rounded-full" disabled={busy || !email.trim() || !password}>{busy ? t("signingIn") : t("signInCta")}</button>
              {error && <p role="alert" className="rounded-[12px] bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
            </form>

            {/* What signing in does and does not mean. */}
            <ul className="mt-8 space-y-2 border-t border-dashed border-signal/30 pt-4 text-xs text-ink-soft">
              {["p1", "p2", "p3"].map((k) => (
                <li key={k} className="flex gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-attention-strong" aria-hidden />{t(`points.${k}`)}</li>
              ))}
            </ul>

          </div>
        </motion.div>
      </main>
    </div>
  );
}
