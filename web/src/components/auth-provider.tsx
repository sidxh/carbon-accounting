"use client";

import { onAuthStateChanged, signOut as firebaseSignOut, type User } from "firebase/auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { firebaseAuth } from "@/lib/firebase";

interface AuthState {
  user: User | null;
  loading: boolean;
  /** True from a deliberate sign-out until the next sign-in, so guards send people to the landing page, not /sign-in. */
  signedOut: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState>({ user: null, loading: true, signedOut: false, signOut: async () => {} });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState({ user: null as User | null, loading: true, signedOut: false });
  useEffect(() => {
    const unsub = onAuthStateChanged(firebaseAuth(), (user) =>
      setState((s) => ({ user, loading: false, signedOut: user ? false : s.signedOut })),
    );
    return unsub;
  }, []);
  const signOut = useCallback(async () => {
    // Set before Firebase drops the user, so RequireAuth never sees a null user without it.
    setState((s) => ({ ...s, signedOut: true }));
    await firebaseSignOut(firebaseAuth());
  }, []);
  const value = useMemo(() => ({ ...state, signOut }), [state, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
