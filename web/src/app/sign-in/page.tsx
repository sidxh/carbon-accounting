"use client";

import {
  RecaptchaVerifier,
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { OTPInput, REGEXP_ONLY_DIGITS } from "input-otp";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { useAuth } from "@/components/auth-provider";
import { Smokescape } from "@/components/landing/smokescape";
import { SiteNav } from "@/components/landing/site-nav";
import { firebaseAuth } from "@/lib/firebase";

const EMULATOR = process.env.NEXT_PUBLIC_USE_EMULATORS === "true";
const CODES = [["+84", "VN"], ["+81", "JP"], ["+91", "IN"], ["+65", "SG"], ["+61", "AU"], ["+66", "TH"], ["+62", "ID"]] as const;

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
                "input relative flex h-14 w-full max-w-[52px] items-center justify-center rounded-[12px] p-0 font-mono text-2xl transition-[border-color,box-shadow] duration-[var(--dur-fast)]",
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
      router.replace("/home");
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

  // Underline fields, as in the landing's light editorial style.
  const field = "w-full rounded-none border-0 border-b border-dashed border-signal/40 bg-transparent px-0 py-2.5 font-mono text-base text-ink placeholder:text-faint focus:border-solid focus:border-signal focus-visible:outline-none";
  const fieldLabel = "text-xs font-medium text-signal-ink";

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

            {!confirmation ? (
              <form onSubmit={sendCode} className="mt-6 space-y-6">
                <div className="flex gap-4">
                  <div className="w-[104px] shrink-0">
                    <label className={fieldLabel} htmlFor="cc">{t("countryCode")}</label>
                    <select id="cc" className={cn(field, "cursor-pointer")} value={cc} onChange={(e) => setCc(e.target.value)}>
                      {CODES.map(([c, n]) => <option key={c} value={c}>{c} {n}</option>)}
                    </select>
                  </div>
                  <div className="min-w-0 flex-1">
                    <label className={fieldLabel} htmlFor="phone">{t("phoneLabel")}</label>
                    <input id="phone" className={field} inputMode="tel" autoComplete="tel-national" placeholder={t("phonePlaceholder")} value={local} onChange={(e) => setLocal(e.target.value)} autoFocus />
                  </div>
                </div>
                <button className="btn w-full rounded-full" disabled={busy || local.replace(/\D/g, "").length < 7}>{busy ? t("sending") : t("sendCode")}</button>
                {error && <p role="alert" className="rounded-[12px] bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
                <p className="text-xs text-muted">{t("smsNote")}</p>
              </form>
            ) : (
              <div className="mt-6 space-y-5">
                <button type="button" className="btn btn-ghost btn-sm -ml-2 gap-1.5" onClick={() => { setConfirmation(null); setCode(""); setError(""); }}>
                  <ArrowLeft className="size-4" aria-hidden />{t("back")}
                </button>
                <div>
                  <div className="text-sm font-medium text-ink">{t("codeLabel")}</div>
                  <div className="mt-0.5 text-xs text-muted">{t("codeSentTo", { phone })}</div>
                </div>
                <OtpInput value={code} onChange={setCode} onComplete={(v) => verify(v)} disabled={busy} />
                {error && <p role="alert" className="rounded-[12px] bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
                <button className="btn w-full rounded-full" onClick={() => verify()} disabled={busy || code.length < 6}>{busy ? t("verifying") : t("verify")}</button>
                <div className="flex items-center justify-between text-xs text-muted">
                  <span>{t("noCode")}</span>
                  <button type="button" className="font-medium text-signal-ink underline-offset-4 hover:underline disabled:text-faint disabled:no-underline" disabled={resendIn > 0 || busy} onClick={() => sendCode()}>
                    {resendIn > 0 ? t("resendIn", { s: resendIn }) : t("resend")}
                  </button>
                </div>
              </div>
            )}

            <div id="recaptcha-slot" />

            <div className="mt-8 border-t border-dashed border-signal/30 pt-4">
              <button type="button" className="flex w-full items-center justify-between text-left text-sm text-ink-soft" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
                {t("otherWays")}<ChevronDown className={cn("size-4 transition-transform", moreOpen && "rotate-180")} aria-hidden />
              </button>
              {moreOpen && (
                <form onSubmit={sendLink} className="mt-4 space-y-3">
                  <label className={fieldLabel} htmlFor="email">{t("emailLabel")}</label>
                  <div className="flex items-end gap-3">
                    <input id="email" className={field} type="email" autoComplete="email" placeholder={t("emailPlaceholder")} value={email} onChange={(e) => setEmail(e.target.value)} />
                    <button className="btn btn-secondary btn-sm shrink-0 rounded-full" disabled={busy || !email.includes("@")}>{t("sendLink")}</button>
                  </div>
                  {linkSent && <p className="text-sm text-signal-ink">{t("linkSent")}</p>}
                  {error && moreOpen && <p role="alert" className="text-sm text-danger">{error}</p>}
                </form>
              )}
            </div>

            {/* What signing in does and does not mean. */}
            <ul className="mt-6 space-y-2 text-xs text-ink-soft">
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
