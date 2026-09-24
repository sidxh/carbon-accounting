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
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { ArrowLeft, ChevronDown, Smartphone } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "@/components/auth-provider";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Wordmark } from "@/components/shell";
import { firebaseAuth } from "@/lib/firebase";

const EMULATOR = process.env.NEXT_PUBLIC_USE_EMULATORS === "true";
const CODES = [["+84", "VN"], ["+81", "JP"], ["+91", "IN"], ["+65", "SG"], ["+61", "AU"], ["+66", "TH"], ["+62", "ID"]] as const;

/** Six single-digit boxes; paste fills them all; the last digit submits. */
function OtpInput({ value, onChange, onComplete, disabled }: { value: string; onChange: (v: string) => void; onComplete: (v: string) => void; disabled: boolean }) {
  const t = useTranslations("signIn");
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? "");

  function set(i: number, ch: string) {
    const next = (value.slice(0, i) + ch + value.slice(i + 1)).replace(/\D/g, "").slice(0, 6);
    onChange(next);
    if (ch && i < 5) refs.current[i + 1]?.focus();
    if (next.length === 6) onComplete(next);
  }

  return (
    <div className="flex justify-between gap-2" role="group" aria-label={t("codeLabel")}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          className="input h-14 w-full max-w-[52px] p-0 text-center font-mono text-2xl"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`${t("codeLabel")} ${i + 1}`}
          maxLength={1}
          value={d}
          disabled={disabled}
          autoFocus={i === 0}
          onChange={(e) => set(i, e.target.value.replace(/\D/g, "").slice(-1))}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !d && i > 0) { refs.current[i - 1]?.focus(); onChange(value.slice(0, i - 1)); }
            if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
            if (e.key === "ArrowRight" && i < 5) refs.current[i + 1]?.focus();
          }}
          onPaste={(e) => {
            const txt = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
            if (txt) { e.preventDefault(); onChange(txt); refs.current[Math.min(txt.length, 5)]?.focus(); if (txt.length === 6) onComplete(txt); }
          }}
        />
      ))}
    </div>
  );
}

export default function SignInPage() {
  const t = useTranslations("signIn");
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
    if (!loading && user) router.replace("/documents");
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
        .then(() => router.replace("/documents"))
        .catch(() => setError(t("error")));
    }
  }, [router, t]);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const auth = firebaseAuth();
      if (!recaptcha.current) {
        recaptcha.current = new RecaptchaVerifier(auth, "recaptcha-slot", { size: "invisible" });
      }
      const result = await signInWithPhoneNumber(auth, phone, recaptcha.current);
      setConfirmation(result);
      setCode("");
      setResendIn(30);
    } catch {
      setError(t("error"));
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
      router.replace("/documents");
    } catch {
      setError(t("wrongCode"));
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
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} className="max-w-lg">
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1 className="font-display mt-4 text-4xl leading-[1.02] sm:text-5xl">{t("title")}</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-muted">{t("lede")}</p>
          <ul className="mt-6 hidden space-y-2 text-sm text-ink-soft lg:block">
            {["p1", "p2", "p3"].map((k) => <li key={k} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-attention-strong" aria-hidden />{t(`points.${k}`)}</li>)}
          </ul>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.08, ease: [0.22, 1, 0.36, 1] }} className="card w-full max-w-md p-6 shadow-[var(--shadow-float)] lg:ml-auto">
          {!confirmation ? (
            <form onSubmit={sendCode} className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium"><Smartphone className="size-4 text-muted" aria-hidden />{t("phoneLabel")}</div>
              <div className="flex gap-2">
                <label className="sr-only" htmlFor="cc">{t("countryCode")}</label>
                <select id="cc" className="input w-[104px] shrink-0 font-mono" value={cc} onChange={(e) => setCc(e.target.value)}>
                  {CODES.map(([c, n]) => <option key={c} value={c}>{c} {n}</option>)}
                </select>
                <label className="sr-only" htmlFor="phone">{t("phoneLabel")}</label>
                <input id="phone" className="input font-mono" inputMode="tel" autoComplete="tel-national" placeholder={t("phonePlaceholder")} value={local} onChange={(e) => setLocal(e.target.value)} autoFocus />
              </div>
              <button className="btn w-full" disabled={busy || local.replace(/\D/g, "").length < 7}>{busy ? t("sending") : t("sendCode")}</button>
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

          {error && <p role="alert" className="mt-4 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}

          <div className="mt-6 border-t hairline pt-4">
            <button type="button" className="flex w-full items-center justify-between text-left text-sm text-muted" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
              {t("otherWays")}<ChevronDown className={clsx("size-4 transition-transform", moreOpen && "rotate-180")} aria-hidden />
            </button>
            {moreOpen && (
              <form onSubmit={sendLink} className="mt-3 space-y-2">
                <label className="label" htmlFor="email">{t("emailLabel")}</label>
                <div className="flex gap-2">
                  <input id="email" className="input" type="email" autoComplete="email" placeholder={t("emailPlaceholder")} value={email} onChange={(e) => setEmail(e.target.value)} />
                  <button className="btn btn-secondary shrink-0" disabled={busy || !email.includes("@")}>{t("sendLink")}</button>
                </div>
                {linkSent && <p className="text-sm text-signal-ink">{t("linkSent")}</p>}
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
