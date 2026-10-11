"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/cn";
import { api, type PlaceSuggestion } from "@/lib/api";

const DEBOUNCE_MS = 300;   // wait for a pause in typing: a full address is a handful of requests, not one per letter
const MIN_CHARS = 3;
const COORDS = /^\s*-?\d{1,3}\.\d+\s*[,;\s]/;   // "10.7290, 106.7190" is pasted coordinates, not something to search for

function newSession(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * A text box that suggests addresses as you type (Google Places, through the agent so the key stays server-side).
 * It is a plain input first: if suggestions are off or fail, typing an address and submitting still works.
 * One search session token covers the typing and the final pick, which is how Google bills it.
 */
export function AddressSearch({ label, value, onChange, onPick, country, placeholder, disabled }: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  onPick: (pick: { place_id: string; text: string; session: string }) => void;
  country?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const t = useTranslations("reduce.locate");
  const uid = useId();
  const listId = `${uid}-list`;
  const [items, setItems] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const session = useRef(newSession());
  // The text we last searched for or picked. The effect below also re-runs when `disabled` flips (the parent
  // disables the box while it locates the picked place), and that must not search for the same text again:
  // it would reopen the list with the option the user just chose.
  const settled = useRef<string | null>(null);

  useEffect(() => {
    if (disabled) { setOpen(false); return; }
    const q = value.trim();
    if (q.length < MIN_CHARS || COORDS.test(q)) { settled.current = null; setItems([]); setOpen(false); return; }
    if (q === settled.current) return;
    const ctl = new AbortController();
    const timer = window.setTimeout(() => {
      settled.current = q;
      api.suggestPlaces(q, session.current, country, ctl.signal)
        .then((r) => { setItems(r.suggestions); setActive(-1); setOpen(r.suggestions.length > 0); })
        .catch(() => { if (!ctl.signal.aborted) { setItems([]); setOpen(false); } });   // suggestions are optional
    }, DEBOUNCE_MS);
    return () => { window.clearTimeout(timer); ctl.abort(); };
  }, [value, country, disabled]);

  function pick(s: PlaceSuggestion) {
    settled.current = s.text.trim();   // quiet until the user types something different
    const used = session.current;
    session.current = newSession();   // the pick ends the billing session; the next search starts a new one
    setOpen(false);
    setItems([]);
    setActive(-1);
    onChange(s.text);
    onPick({ place_id: s.place_id, text: s.text, session: used });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % items.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i <= 0 ? items.length - 1 : i - 1)); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(items[active]); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  }

  return (
    <div className="relative min-w-0 grow">
      <label className="label" htmlFor={`${uid}-input`}>{label}</label>
      <input
        id={`${uid}-input`}
        className="input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${uid}-opt-${active}` : undefined}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => items.length > 0 && setOpen(true)}
        onBlur={() => setOpen(false)}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label={label}
        hidden={!open}
        className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-[var(--radius)] border border-line bg-raised py-1 shadow-lg"
      >
        {items.map((s, i) => (
          <li
            key={s.place_id}
            id={`${uid}-opt-${i}`}
            role="option"
            aria-selected={i === active}
            className={cn("flex min-h-11 cursor-pointer items-start gap-2 px-3 py-2 text-sm", i === active ? "bg-sunken" : "hover:bg-sunken")}
            onMouseDown={(e) => e.preventDefault()}   // keep focus in the input so blur does not close the list before the click lands
            onMouseEnter={() => setActive(i)}
            onClick={() => pick(s)}
          >
            <MapPin className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
            <span className="min-w-0"><span className="block font-medium">{s.main}</span>{s.secondary && <span className="block truncate text-xs text-muted">{s.secondary}</span>}</span>
          </li>
        ))}
      </ul>
      <p className="sr-only" role="status" aria-live="polite">{open ? t("suggestionCount", { n: items.length }) : ""}</p>
    </div>
  );
}
