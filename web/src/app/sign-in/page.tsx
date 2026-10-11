"use client";

import {
  RecaptchaVerifier,
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from "firebase/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { motion } from "motion/react";
import { OTPInput, REGEXP_ONLY_DIGITS } from "input-otp";
import { ArrowLeft, ChevronDown, Smartphone } from "lucide-react";
import { cn } from "@/lib/cn";
import { useAuth } from "@/components/auth-provider";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Wordmark } from "@/components/shell";
import { firebaseAuth } from "@/lib/firebase";
import { SUPPORTED_COUNTRIES, isSupportedNumber, signInErrorKey, supportedCountriesText } from "@/lib/phone-countries";

const EMULATOR = process.env.NEXT_PUBLIC_USE_EMULATORS === "true";

/**
 * Six-digit code on input-otp: one real input (autofill, paste, caret,
 * screen-reader friendly) rendered as six slots. The last digit submits.
 */
function OtpInput({ value, onChange, onComplete, disabled }: { value: string; onChange: (v: string) => void; onComplete: (v: string) => void; disabled: boolean }) {
  const t = useTranslations("signIn");
  return (
    <OTPInput
      value={value}
      onChange={onChange}
      onComplete={onComplete}
      maxLength={6}
      disabled={disabled}
      autoFocus
      inputMode="numeric"
      pattern={REGEXP_ONLY_DIGITS}
      aria-label={t("codeLabel")}
      containerClassName="flex justify-between gap-2 has-[:disabled]:opacity-60"
      render={({ slots }) => (
        <>
          {slots.map((slot, i) => (
            <div
              key={i}
              className={cn(
                "input relative flex h-14 w-full max-w-[52px] items-center justify-center p-0 font-mono text-2xl transition-[border-color,box-shadow] duration-[var(--dur-fast)]",
                slot.isActive && "border-signal shadow-[0_0_0_3px_var(--signal-bg)]",
              )}
            >
              {slot.char ?? (slot.hasFakeCaret ? <span className="h-7 w-px animate-pulse bg-ink" aria-hidden /> : <span className="text-faint">·</span>)}
            </div>
          ))}
        </>
      )}
    />
  );
}

export default function SignInPage() {
  const t = useTranslations("signIn");
  const locale = useLocale();
  const router = useRouter();
  const { user, loading } = useAuth();

  const [cc, setCc] = useState<string>("+84");
  const [local, setLocal] = useState("");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [linkSent, setLinkSent] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const recaptcha = useRef<RecaptchaVerifier | null>(null);

  // A pasted international number ("+84 90…") wins over the country-code chip.
  const phone = local.trim().startsWith("+")
    ? "+" + local.replace(/\D/g, "")
    : `${cc}${local.replace(/\D/g, "").replace(/^0+/, "")}`;

  useEffect(() => {
    if (!loading && user) router.replace("/home");
  }, [user, loading, router]);

  useEffect(() => {
    if (!resendIn) return;
    const id = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  // Complete an email-link sign-in if we arrived via one.
  useEffect(() => {
    const auth = firebaseAuth();
    if (isSignInWithEmailLink(auth, window.location.href)) {
      const saved = window.localStorage.getItem("signInEmail") ?? window.prompt("Email") ?? "";
      signInWithEmailLink(auth, saved, window.location.href)
        .then(() => router.replace("/home"))
        .catch(() => setError(t("error")));
    }
  }, [router, t]);

  const showError = (code: string | undefined, step: "phone" | "code") => {
    const key = signInErrorKey(code, step);
    setError(key === "notSupported" ? t("notSupported", { countries: supportedCountriesText(locale) }) : t(key));
  };

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setError("");
    // A pasted international number from a country we cannot text: say so without a round trip.
    if (!isSupportedNumber(phone)) {
      setError(t("notSupported", { countries: supportedCountriesText(locale) }));
      return;
    }
    setBusy(true);
    try {
      const auth = firebaseAuth();
      if (!recaptcha.current) {
        recaptcha.current = new RecaptchaVerifier(auth, "recaptcha-slot", { size: "invisible" });
      }
      const result = await signInWithPhoneNumber(auth, phone, recaptcha.current);
      setConfirmation(result);
      setCode("");
      setResendIn(30);
    } catch (err) {
      showError((err as { code?: string }).code, "phone");
      recaptcha.current?.clear();
      recaptcha.current = null;
    } finally {
      setBusy(false);
    }
  }

  async function verify(value = code) {
    if (!confirmation || value.length < 6 || busy) return;
    setBusy(true);
    setError("");
    try {
      await confirmation.confirm(value.trim());
      router.replace("/home");
    } catch (err) {
      showError((err as { code?: string }).code, "code");
      setCode("");
      setBusy(false);
    }
  }

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      window.localStorage.setItem("signInEmail", email.trim());
      await sendSignInLinkToEmail(firebaseAuth(), email.trim(), { url: `${window.location.origin}/sign-in`, handleCodeInApp: true });
      setLinkSent(true);
    } catch {
      setError(t("error"));
    } finally {
      setBusy(false);
    }
  }

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
          {!confirmation ? (
            <form onSubmit={sendCode} className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium"><Smartphone className="size-4 text-muted" aria-hidden />{t("phoneLabel")}</div>
              <div className="flex gap-2">
                <label className="sr-only" htmlFor="cc">{t("countryCode")}</label>
                <select id="cc" className="input w-[104px] shrink-0 font-mono" value={cc} onChange={(e) => setCc(e.target.value)}>
                  {SUPPORTED_COUNTRIES.map((c) => <option key={c.dial} value={c.dial}>{c.dial} {c.iso}</option>)}
                </select>
                <label className="sr-only" htmlFor="phone">{t("phoneLabel")}</label>
                <input id="phone" className="input font-mono" inputMode="tel" autoComplete="tel-national" placeholder={t("phonePlaceholder")} value={local} onChange={(e) => setLocal(e.target.value)} autoFocus />
              </div>
              <button className="btn w-full" disabled={busy || local.replace(/\D/g, "").length < 7}>{busy ? t("sending") : t("sendCode")}</button>
              {error && <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
              <p className="text-xs text-muted">{t("smsNote")}</p>
            </form>
          ) : (
            <div className="space-y-4">
              <button type="button" className="btn btn-ghost btn-sm -ml-2 gap-1.5" onClick={() => { setConfirmation(null); setCode(""); setError(""); }}>
                <ArrowLeft className="size-4" aria-hidden />{t("back")}
              </button>
              <div>
                <div className="text-sm font-medium">{t("codeLabel")}</div>
                <div className="mt-0.5 text-xs text-muted">{t("codeSentTo", { phone })}</div>
              </div>
              <OtpInput value={code} onChange={setCode} onComplete={(v) => verify(v)} disabled={busy} />
              {error && <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
              <button className="btn w-full" onClick={() => verify()} disabled={busy || code.length < 6}>{busy ? t("verifying") : t("verify")}</button>
              <div className="flex items-center justify-between text-xs text-muted">
                <span>{t("noCode")}</span>
                <button type="button" className="font-medium text-signal-ink underline-offset-4 hover:underline disabled:text-faint disabled:no-underline" disabled={resendIn > 0 || busy} onClick={() => sendCode()}>
                  {resendIn > 0 ? t("resendIn", { s: resendIn }) : t("resend")}
                </button>
              </div>
            </div>
          )}

          <div id="recaptcha-slot" />

          <div className="mt-6 border-t hairline pt-4">
            <button type="button" className="flex w-full items-center justify-between text-left text-sm text-muted" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
              {t("otherWays")}<ChevronDown className={cn("size-4 transition-transform", moreOpen && "rotate-180")} aria-hidden />
            </button>
            {moreOpen && (
              <form onSubmit={sendLink} className="mt-3 space-y-2">
                <label className="label" htmlFor="email">{t("emailLabel")}</label>
                <div className="flex gap-2">
                  <input id="email" className="input" type="email" autoComplete="email" placeholder={t("emailPlaceholder")} value={email} onChange={(e) => setEmail(e.target.value)} />
                  <button className="btn btn-secondary shrink-0" disabled={busy || !email.includes("@")}>{t("sendLink")}</button>
                </div>
                {linkSent && <p className="text-sm text-signal-ink">{t("linkSent")}</p>}
                {error && moreOpen && <p role="alert" className="text-sm text-danger">{error}</p>}
              </form>
            )}
          </div>

          {EMULATOR && (
            <p className="mt-4 rounded-lg bg-sunken px-3 py-2 font-mono text-[11px] leading-relaxed text-muted">{t("devHint")}</p>
          )}
        </motion.div>
      </main>
    </div>
  );
}
