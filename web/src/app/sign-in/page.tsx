"use client";

import { isSignInWithEmailLink, sendSignInLinkToEmail, signInWithEmailLink } from "firebase/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { ArrowLeft, Mail } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Wordmark } from "@/components/shell";
import { firebaseAuth } from "@/lib/firebase";

const EMULATOR = process.env.NEXT_PUBLIC_USE_EMULATORS === "true";
const EMAIL_KEY = "signInEmail";

type Step = "enter" | "sent" | "confirm" | "finishing";

/** Firebase error code to the message key in `signIn`. */
function errorKey(code: string | undefined): "invalidEmail" | "linkExpired" | "tooMany" | "network" | "unavailable" | "error" {
  switch (code) {
    case "auth/invalid-email":
    case "auth/missing-email":
      return "invalidEmail";
    case "auth/expired-action-code":
    case "auth/invalid-action-code":
      return "linkExpired";
    case "auth/too-many-requests":
    case "auth/quota-exceeded":
      return "tooMany";
    case "auth/network-request-failed":
      return "network";
    // Project settings, not something the user typed: this address is not in Authorized domains, or email
    // links are switched off.
    case "auth/unauthorized-continue-uri":
    case "auth/invalid-continue-uri":
    case "auth/operation-not-allowed":
      return "unavailable";
    default:
      return "error";
  }
}

export default function SignInPage() {
  const t = useTranslations("signIn");
  const router = useRouter();
  const { user, loading } = useAuth();

  const [step, setStep] = useState<Step>("enter");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const finishing = useRef(false);

  useEffect(() => {
    if (!loading && user) router.replace("/home");
  }, [user, loading, router]);

  useEffect(() => {
    if (!resendIn) return;
    const id = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  const showError = useCallback((err: unknown) => {
    const code = (err as { code?: string }).code;
    console.error("sign-in failed:", code);
    setError(t(errorKey(code)));
  }, [t]);

  const finish = useCallback(
    async (address: string) => {
      setBusy(true);
      setError("");
      setStep("finishing");
      try {
        await signInWithEmailLink(firebaseAuth(), address.trim(), window.location.href);
        window.localStorage.removeItem(EMAIL_KEY);
        router.replace("/home");
      } catch (err) {
        showError(err);
        setStep(errorKey((err as { code?: string }).code) === "invalidEmail" ? "confirm" : "enter");
        setBusy(false);
      }
    },
    [router, showError],
  );

  // Arriving from the emailed link: finish on the saved address, or ask for it when the link
  // was opened on another device or browser.
  useEffect(() => {
    if (finishing.current || !isSignInWithEmailLink(firebaseAuth(), window.location.href)) return;
    finishing.current = true;
    const saved = window.localStorage.getItem(EMAIL_KEY);
    if (saved) void finish(saved);
    else setStep("confirm");
  }, [finish]);

  async function sendLink(e?: React.FormEvent) {
    e?.preventDefault();
    const address = email.trim();
    if (!address.includes("@") || busy) return;
    setBusy(true);
    setError("");
    try {
      await sendSignInLinkToEmail(firebaseAuth(), address, { url: `${window.location.origin}/sign-in`, handleCodeInApp: true });
      window.localStorage.setItem(EMAIL_KEY, address);
      setStep("sent");
      setResendIn(30);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  const errorBox = error && <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>;

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 pt-4 sm:px-6">
        <Link href="/" className="rounded-lg"><Wordmark /></Link>
        <LanguageSwitcher />
      </header>

      <main className="mx-auto grid w-full max-w-5xl gap-10 px-4 pb-16 pt-10 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:pt-20">
        <motion.div initial={{ opacity: 0, transform: "translateY(8px)" }} animate={{ opacity: 1, transform: "translateY(0px)" }} transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }} className="max-w-lg">
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1 className="font-display mt-4 text-4xl leading-[1.02] text-balance sm:text-5xl">{t("title")}</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-pretty text-muted">{t("lede")}</p>
          <ul className="mt-6 hidden space-y-2 text-sm text-ink-soft lg:block">
            {["p1", "p2", "p3"].map((k) => <li key={k} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-attention-strong" aria-hidden />{t(`points.${k}`)}</li>)}
          </ul>
        </motion.div>

        <motion.div initial={{ opacity: 0, transform: "translateY(8px) scale(0.98)" }} animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }} transition={{ duration: 0.22, delay: 0.05, ease: [0.23, 1, 0.32, 1] }} className="card w-full max-w-md p-6 shadow-[var(--shadow-float)] lg:ml-auto">
          {step === "enter" && (
            <form onSubmit={sendLink} className="space-y-4">
              <label className="flex items-center gap-2 text-sm font-medium" htmlFor="email"><Mail className="size-4 text-muted" aria-hidden />{t("emailLabel")}</label>
              <input id="email" className="input" type="email" inputMode="email" autoComplete="email" placeholder={t("emailPlaceholder")} value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
              <button className="btn w-full" disabled={busy || !email.includes("@")}>{busy ? t("sending") : t("sendLink")}</button>
              {errorBox}
            </form>
          )}

          {step === "sent" && (
            <div className="space-y-4">
              <button type="button" className="btn btn-ghost btn-sm -ml-2 gap-1.5" onClick={() => { setStep("enter"); setError(""); }}>
                <ArrowLeft className="size-4" aria-hidden />{t("changeEmail")}
              </button>
              <div>
                <div className="font-display text-2xl">{t("checkTitle")}</div>
                <p className="mt-2 text-sm text-pretty text-ink-soft">{t("linkSentTo", { email: email.trim() })}</p>
                <p className="mt-2 text-xs text-muted">{t("linkNote")}</p>
              </div>
              {errorBox}
              <div className="flex items-center justify-between text-xs text-muted">
                <span>{t("noLink")}</span>
                <button type="button" className="font-medium text-signal-ink underline-offset-4 hover:underline disabled:text-faint disabled:no-underline" disabled={resendIn > 0 || busy} onClick={() => sendLink()}>
                  {resendIn > 0 ? t("resendIn", { s: resendIn }) : t("resend")}
                </button>
              </div>
            </div>
          )}

          {step === "confirm" && (
            <form onSubmit={(e) => { e.preventDefault(); void finish(email); }} className="space-y-4">
              <div>
                <div className="font-display text-2xl">{t("confirmTitle")}</div>
                <p className="mt-2 text-sm text-pretty text-ink-soft">{t("confirmBody")}</p>
              </div>
              <label className="sr-only" htmlFor="confirm-email">{t("emailLabel")}</label>
              <input id="confirm-email" className="input" type="email" inputMode="email" autoComplete="email" placeholder={t("emailPlaceholder")} value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
              <button className="btn w-full" disabled={busy || !email.includes("@")}>{t("confirmButton")}</button>
              {errorBox}
            </form>
          )}

          {step === "finishing" && (
            <div role="status" className="py-6 text-center text-sm text-muted">{t("finishing")}</div>
          )}

          {EMULATOR && (
            <p className="mt-4 rounded-lg bg-sunken px-3 py-2 font-mono text-[11px] leading-relaxed text-muted">{t("devHint")}</p>
          )}
        </motion.div>
      </main>
    </div>
  );
}
