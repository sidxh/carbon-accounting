"use client";

import { isSignInWithEmailLink, sendSignInLinkToEmail, signInWithEmailLink } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { ArrowLeft, MailQuestion } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Smokescape } from "@/components/landing/smokescape";
import { SiteNav } from "@/components/landing/site-nav";
import { AUTH_EMAIL_SENDER, firebaseAuth } from "@/lib/firebase";

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

// Underline fields, as in the landing's light editorial style.
const field = "w-full rounded-none border-0 border-b border-dashed border-signal/40 bg-transparent px-3 py-2.5 font-mono text-base text-ink placeholder:text-faint focus:border-solid focus:border-signal focus-visible:outline-none";
const fieldLabel = "px-3 text-xs font-medium text-signal-ink";

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

  const errorBox = error && <p role="alert" className="rounded-[12px] bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>;

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

            {step === "enter" && (
              <form onSubmit={sendLink} className="mt-6 space-y-6">
                <div>
                  <label className={fieldLabel} htmlFor="email">{t("emailLabel")}</label>
                  <input id="email" className={field} type="email" inputMode="email" autoComplete="email" placeholder={t("emailPlaceholder")} value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
                </div>
                <button className="btn w-full rounded-full" disabled={busy || !email.includes("@")}>{busy ? t("sending") : t("sendLink")}</button>
                {errorBox}
              </form>
            )}

            {step === "sent" && (
              <div className="mt-6 space-y-5">
                <button type="button" className="btn btn-ghost btn-sm -ml-2 gap-1.5" onClick={() => { setStep("enter"); setError(""); }}>
                  <ArrowLeft className="size-4" aria-hidden />{t("changeEmail")}
                </button>
                <div>
                  <div className="font-display text-2xl">{t("checkTitle")}</div>
                  <p className="mt-2 text-sm text-pretty text-ink-soft">{t("linkSentTo", { email: email.trim() })}</p>
                </div>
                <div role="note" className="flex gap-2.5 rounded-[12px] bg-attention-bg px-3 py-2.5 text-sm text-ink-soft">
                  <MailQuestion className="mt-0.5 size-4 shrink-0 text-attention" aria-hidden />
                  <div>
                    <p className="font-medium text-ink">{t("spamTitle")}</p>
                    <p className="mt-0.5 text-pretty">{t("spamHint", { sender: AUTH_EMAIL_SENDER })}</p>
                  </div>
                </div>
                <p className="text-xs text-muted">{t("linkNote")}</p>
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
              <form onSubmit={(e) => { e.preventDefault(); void finish(email); }} className="mt-6 space-y-5">
                <div>
                  <div className="font-display text-2xl">{t("confirmTitle")}</div>
                  <p className="mt-2 text-sm text-pretty text-ink-soft">{t("confirmBody")}</p>
                </div>
                <label className="sr-only" htmlFor="confirm-email">{t("emailLabel")}</label>
                <input id="confirm-email" className={field} type="email" inputMode="email" autoComplete="email" placeholder={t("emailPlaceholder")} value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
                <button className="btn w-full rounded-full" disabled={busy || !email.includes("@")}>{t("confirmButton")}</button>
                {errorBox}
              </form>
            )}

            {step === "finishing" && (
              <div role="status" className="py-8 text-center text-sm text-muted">{t("finishing")}</div>
            )}

            {/* What signing in does and does not mean. */}
            <ul className="mt-8 space-y-2 border-t border-dashed border-signal/30 pt-4 text-xs text-ink-soft">
              {["p1", "p2", "p3"].map((k) => (
                <li key={k} className="flex gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-attention-strong" aria-hidden />{t(`points.${k}`)}</li>
              ))}
            </ul>

            {EMULATOR && (
              <p className="mt-5 rounded-[12px] bg-sunken px-3 py-2 font-mono text-[11px] leading-relaxed text-muted">{t("devHint")}</p>
            )}
          </div>
        </motion.div>
      </main>
    </div>
  );
}
