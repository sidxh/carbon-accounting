/**
 * Countries the sign-in page can text. Keep this in step with Firebase console,
 * Authentication > Settings > SMS region policy: a country missing there is refused by
 * Firebase with auth/operation-not-allowed, and this list is what the error message shows.
 */
export const SUPPORTED_COUNTRIES = [
  { dial: "+84", iso: "VN" },
  { dial: "+81", iso: "JP" },
  { dial: "+91", iso: "IN" },
  { dial: "+65", iso: "SG" },
  { dial: "+61", iso: "AU" },
  { dial: "+66", iso: "TH" },
  { dial: "+62", iso: "ID" },
] as const;

// Allowed in the region policy only so the fictional +1 888 test number works; not offered to users.
const ALSO_ACCEPTED = ["+1"];

/** True when a full international number starts with a dial code we can text. */
export function isSupportedNumber(e164: string): boolean {
  return [...SUPPORTED_COUNTRIES.map((c) => c.dial), ...ALSO_ACCEPTED].some((d) => e164.startsWith(d));
}

/** "Vietnam (+84), Japan (+81), ..." in the reader's language. */
export function supportedCountriesText(locale: string): string {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([locale], { type: "region" });
  } catch {
    names = null;
  }
  return SUPPORTED_COUNTRIES.map((c) => `${names?.of(c.iso) ?? c.iso} (${c.dial})`).join(", ");
}

export type SignInErrorKey =
  | "notSupported"
  | "invalidPhone"
  | "tooMany"
  | "captcha"
  | "network"
  | "codeExpired"
  | "wrongCode"
  | "error";

/** Maps a Firebase Auth error code to the message key shown to the user. */
export function signInErrorKey(code: string | undefined, step: "phone" | "code"): SignInErrorKey {
  switch (code) {
    case "auth/operation-not-allowed":
      return "notSupported";
    case "auth/invalid-phone-number":
    case "auth/missing-phone-number":
      return "invalidPhone";
    case "auth/too-many-requests":
    case "auth/quota-exceeded":
      return "tooMany";
    case "auth/captcha-check-failed":
    case "auth/invalid-app-credential":
    case "auth/missing-app-credential":
      return "captcha";
    case "auth/network-request-failed":
      return "network";
    case "auth/code-expired":
      return "codeExpired";
    case "auth/invalid-verification-code":
    case "auth/missing-verification-code":
      return "wrongCode";
    default:
      return step === "code" ? "wrongCode" : "error";
  }
}
