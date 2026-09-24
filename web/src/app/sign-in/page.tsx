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
import { useAuth } from "@/components/auth-provider";
import { Shell } from "@/components/shell";
import { firebaseAuth } from "@/lib/firebase";

const EMULATOR = process.env.NEXT_PUBLIC_USE_EMULATORS === "true";

export default function SignInPage() {
  const t = useTranslations("signIn");
  const router = useRouter();
  const { user, loading } = useAuth();

  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [linkSent, setLinkSent] = useState(false);
  const recaptcha = useRef<RecaptchaVerifier | null>(null);

  useEffect(() => {
    if (!loading && user) router.replace("/documents");
  }, [user, loading, router]);

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

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const auth = firebaseAuth();
      if (!recaptcha.current) {
        recaptcha.current = new RecaptchaVerifier(auth, "recaptcha-slot", { size: "invisible" });
      }
      const result = await signInWithPhoneNumber(auth, phone.trim(), recaptcha.current);
      setConfirmation(result);
    } catch {
      setError(t("error"));
      recaptcha.current?.clear();
      recaptcha.current = null;
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmation) return;
    setBusy(true);
    setError("");
    try {
      await confirmation.confirm(code.trim());
      router.replace("/documents");
    } catch {
      setError(t("error"));
    } finally {
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
    <Shell showSteps={false}>
      <div className="card mx-auto mt-6 max-w-md p-6">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">{t("lede")}</p>

        {!confirmation ? (
          <form onSubmit={sendCode} className="mt-6 space-y-3">
            <label className="label" htmlFor="phone">{t("phoneLabel")}</label>
            <input id="phone" className="input font-mono" inputMode="tel" autoComplete="tel" placeholder={t("phonePlaceholder")} value={phone} onChange={(e) => setPhone(e.target.value)} />
            <button className="btn w-full" disabled={busy || phone.trim().length < 8}>{t("sendCode")}</button>
          </form>
        ) : (
          <form onSubmit={verify} className="mt-6 space-y-3">
            <label className="label" htmlFor="code">{t("codeLabel")}</label>
            <input id="code" className="input text-center font-mono text-2xl tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus />
            <button className="btn w-full" disabled={busy || code.length < 6}>{t("verify")}</button>
            <button type="button" className="w-full text-sm text-[var(--muted)] underline-offset-4 hover:underline" onClick={() => { setConfirmation(null); setCode(""); }}>{t("back")}</button>
          </form>
        )}

        <div id="recaptcha-slot" />

        <div className="mt-8 border-t border-[var(--line)] pt-5">
          <form onSubmit={sendLink} className="space-y-3">
            <label className="label" htmlFor="email">{t("emailLabel")}</label>
            <div className="flex gap-2">
              <input id="email" className="input" type="email" placeholder={t("emailPlaceholder")} value={email} onChange={(e) => setEmail(e.target.value)} />
              <button className="btn btn-secondary shrink-0" disabled={busy || !email.includes("@")}>{t("sendLink")}</button>
            </div>
            {linkSent && <p className="text-sm text-[var(--accent)]">{t("linkSent")}</p>}
          </form>
        </div>

        {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
        {EMULATOR && <p className="mt-4 text-xs text-[var(--muted)]">{t("devHint")}</p>}
      </div>
    </Shell>
  );
}
