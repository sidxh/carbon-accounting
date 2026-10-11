"use client";

import { firebaseAuth } from "./firebase";

export const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function token(): Promise<string> {
  const user = firebaseAuth().currentUser;
  if (!user) throw new ApiError(401, "Not signed in");
  return user.getIdToken();
}

function appLocale(): string {
  return document.cookie.match(/(?:^|; )NEXT_LOCALE=(\w+)/)?.[1] ?? "en";
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${await token()}`);
  headers.set("X-Locale", appLocale());   // the agent asks its follow-up questions in the language the app is shown in
  const res = await fetch(`${AGENT_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? JSON.stringify(body);
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function json<T>(path: string, method: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// --- types mirrored from the agent's models -------------------------------

export interface Site {
  id: string;
  name: string;
  country: string;
  region?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  formatted_address?: string | null;
  location_precision?: "exact" | "approximate" | null;
  roof_area_m2?: number | null;
}

export interface SupplierProfile {
  id: string;
  name: string;
  country: string;
  language: string;
  fiscal_year_start: string;
  fiscal_year_end: string;
  sites: Site[];
  sector: string;
  revenue?: number | null;
  revenue_currency?: string | null;
}

export interface DocumentRecord {
  id: string;
  filename: string;
  mime_type: string;
  site_id?: string | null;
  status: "uploaded" | "extracting" | "extracted" | "failed";
  extraction?: { lines: { energy_type: string; quantity: number; unit: string; period_start: string; period_end: string; confidence: number }[]; confidence: number; warnings: string[] } | null;
  error?: string | null;
  created_at: string;
}

export interface ChatTurn {
  role: "user" | "agent";
  text: string;
  at: string;
}

export interface EnergySummary {
  energy_type: string;
  documents: number;
  lines: number;
  quantity: number;
  unit: string;
  periodic: boolean;
  coverage: string[];
  months_missing: number;
  months_estimated: number;
}

export interface ReconcileSummary {
  months: string[];
  energy: EnergySummary[];
  documents: number;
  lines: number;
  duplicates_dropped: number;
  outside_fy: number;
  converted: number;
  apportioned: number;
  estimated_lines: number;
  open_issues: number;
  resolved_issues: number;
}

export interface Issue { id: string; kind: string; energy_type?: string | null; months: string[]; detail: string; resolved: boolean }

export interface ReconcileState {
  supplier_id: string;
  status: "idle" | "asking" | "done";
  issues: Issue[];
  pending_issue_id?: string | null;
  history: ChatTurn[];
  dropped_outside_fy: string[];
  summary: ReconcileSummary;
}

export interface InventoryLine {
  id: string;
  site_id?: string | null;
  scope: number;
  energy_type: string;
  quantity: number;
  unit: string;
  factor_id: string;
  factor_value: number;
  factor_citation: string;
  method: string;
  basis?: "location" | "market" | null;
  kg_co2e: number;
  biogenic_kg_co2: number;
  tier: "primary" | "secondary" | "estimated";
  source_doc_id: string;
  activity_line_id: string;
  assumption_ids: string[];
  period_start: string;
  period_end: string;
  factor_source_name: string;
  factor_source_url: string;
  factor_vintage: string;
  factor_country: string;
  factor_region?: string | null;
  factor_year?: number | null;
  factor_gas?: string | null;
  exact_year: boolean;
  exact_region: boolean;
  fell_back_to?: string | null;
  activity_notes: string;
}

export interface Totals {
  scope1_kg: number;
  scope2_location_kg: number;
  scope2_market_kg: number;
  biogenic_kg: number;
  by_site: Record<string, { scope1: number; scope2_location: number; scope2_market: number }>;
  by_energy_type: Record<string, number>;
  tier_mix: Record<string, number>;
  line_count: number;
  by_month: Record<string, { scope1: number; scope2_location: number; estimated: number }>;
}

export interface Snapshot {
  reporting_year: number;
  totals: Totals;
  skipped: [string, string][];
  computed_at: string;
}

export interface Assumption {
  id: string;
  question: string;
  answer: string;
  applied_to: string[];
  method: string;
}

export interface MeterRegister {
  label: string;
  previous?: number | null;
  current?: number | null;
  multiplier: number;
  consumption?: number | null;
}

/** One deterministic plausibility check on a bill line. */
export interface LineCheck {
  id: "index" | "price" | "season";
  status: "pass" | "fail" | "confirmed";
  detail: string;
}

export interface ActivityLine {
  id: string;
  source_doc_id: string;
  site_id?: string | null;
  energy_type: string;
  quantity: number;
  unit: string;
  period_start: string;
  period_end: string;
  confidence: number;
  tier: string;
  assumption_ids: string[];
  notes: string;
  /** [ymin, xmin, ymax, xmax] on a 0..1000 scale of the source page: where the printed value sits. */
  quantity_box?: number[] | null;
  period_box?: number[] | null;
  page?: number;
  registers?: MeterRegister[];
  checks?: LineCheck[];
}

export interface Answer {
  question_id: string;
  ref?: string | null;
  question: string;
  field: string;
  value: string | number | null;
  source: string;
  flagged: boolean;
  flag_reason?: string | null;
  /** False for calculator numbers, which are corrected in the inventory instead. */
  editable: boolean;
  /** True once the supplier typed the value themselves. */
  edited: boolean;
}

export interface QuestionnaireRecord {
  id: string;
  request_id?: string | null;
  period_id?: string;
  filled_key?: string | null;
  answers: Answer[];
  status: string;
  created_at: string;
}

export interface ReportingPeriod {
  id: string;
  label: string;
  start: string;
  end: string;
  created_at: string;
}

export type RequestStatus = "new" | "bills" | "questions" | "inventory" | "filled";

export interface CustomerRequest {
  id: string;
  customer_name: string;
  period_id: string;
  template_filename?: string | null;
  template_key?: string | null;
  due_date?: string | null;
  customer_share?: number | null;
  questionnaire_id?: string | null;
  created_at: string;
  updated_at: string;
}

/** What the period has reached; drives the step gating. */
export interface Progress {
  bills: boolean;
  questions: boolean;
  inventory: boolean;
  documents: number;
  reconcile_status: "idle" | "asking" | "done";
}

export interface RequestView {
  request: CustomerRequest;
  period: ReportingPeriod | null;
  status: RequestStatus;
  progress: Progress;
  shared_with: string[];
}

export interface PeriodView {
  period: ReportingPeriod;
  progress: Progress;
  summary: ReconcileSummary;
  totals: Totals | null;
  used_by: string[];
}

export interface HomeView {
  profile: SupplierProfile;
  periods: PeriodView[];
  requests: RequestView[];
}

// --- calls ---------------------------------------------------------------------

export interface SolarOption {
  available: boolean;
  precision: "solar_api" | "pvgis_estimate" | null;
  needs_roof_area: boolean;
  kwp: number;
  panels: number | null;
  annual_kwh: number;
  share_of_electricity: number;
  avoided_location_kg: number;
  avoided_market_kg: number;
  roof_area_m2: number | null;
  imagery_quality: string | null;
  imagery_date: string | null;
  capex: number | null;
  currency: string | null;
  tariff: number | null;
  tariff_source: string;
  annual_saving: number | null;
  payback_years: number | null;
  notes: string[];
}

export interface LeverResult {
  id: string;
  name: string;
  kind: string;
  basis: "location" | "market" | "scope1";
  baseline_kg: number;
  saved_min_kg: number;
  saved_max_kg: number;
  saved_mid_kg: number;
  beneficial: boolean;
  cost_class: "low" | "medium" | "high";
  cost_note: string;
  source_name: string;
  source_url: string;
  note: string;
}

export interface Advice {
  site_id: string | null;
  annual_electricity_kwh: number;
  scope1_kg: number;
  scope2_location_kg: number;
  scope2_market_kg: number;
  grid_factor: number | null;
  market_factor: number | null;
  solar: SolarOption;
  levers: LeverResult[];
}

export interface AdvisorView {
  site: Site | null;
  located: boolean;
  coverage: "solar_api" | "pvgis" | "none";
  error: string | null;
  advice: Advice;
}

const P = (uid: string, pid: string) => `/suppliers/${uid}/periods/${pid}`;
const R = (uid: string, rid: string) => `/suppliers/${uid}/requests/${rid}`;

export const api = {
  health: () => fetch(`${AGENT_URL}/health`).then((r) => r.json()),

  getSupplier: (uid: string) => request<SupplierProfile>(`/suppliers/${uid}`),
  upsertSupplier: (body: Omit<SupplierProfile, "id" | "sites"> & { sites: Omit<Site, "id">[] }) =>
    json<SupplierProfile>("/suppliers", "POST", body),
  /** Drops every period, request and questionnaire; the profile stays. */
  resetAll: (uid: string) => request<{ scope: string }>(`/suppliers/${uid}/data`, { method: "DELETE" }),

  // home, periods, requests
  home: (uid: string) => request<HomeView>(`/suppliers/${uid}/home`),
  listPeriods: (uid: string) => request<{ periods: ReportingPeriod[] }>(`/suppliers/${uid}/periods`),
  createPeriod: (uid: string, body: { start: string; end: string; label?: string }) => json<ReportingPeriod>(`/suppliers/${uid}/periods`, "POST", body),
  getPeriod: (uid: string, pid: string) => request<{ period: ReportingPeriod; progress: Progress }>(P(uid, pid)),
  /** "chat" keeps the bills and rebuilds lines from their extractions; "all" empties the period. */
  resetPeriod: (uid: string, pid: string, scope: "chat" | "all") =>
    request<{ scope: string; activity_lines: number }>(`${P(uid, pid)}/data?scope=${scope}`, { method: "DELETE" }),

  listRequests: (uid: string) => request<{ requests: RequestView[] }>(`/suppliers/${uid}/requests`),
  createRequest: (uid: string, body: { customer_name: string; period_id?: string; new_period?: { start: string; end: string; label?: string }; due_date?: string | null; customer_share?: number | null }) =>
    json<RequestView>(`/suppliers/${uid}/requests`, "POST", body),
  getRequest: (uid: string, rid: string) => request<RequestView>(R(uid, rid)),
  patchRequest: (uid: string, rid: string, body: { customer_name?: string; due_date?: string | null; customer_share?: number | null; clear_due_date?: boolean }) =>
    json<RequestView>(R(uid, rid), "PATCH", body),
  deleteRequest: (uid: string, rid: string) => request<void>(R(uid, rid), { method: "DELETE" }),
  /** Removes the year with its bills, inventory, files and every request made for it. */
  deletePeriod: (uid: string, pid: string) => request<void>(`/suppliers/${uid}/periods/${pid}`, { method: "DELETE" }),
  uploadRequestTemplate: (uid: string, rid: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<RequestView>(`${R(uid, rid)}/template`, { method: "POST", body: fd });
  },

  // documents (period)
  listDocuments: (uid: string, pid: string) => request<{ documents: DocumentRecord[] }>(`${P(uid, pid)}/documents`),
  uploadDocuments: async (uid: string, pid: string, files: File[], siteId?: string) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    if (siteId) fd.append("site_id", siteId);
    return request<{ documents: DocumentRecord[] }>(`${P(uid, pid)}/documents`, { method: "POST", body: fd });
  },
  deleteDocument: (uid: string, pid: string, docId: string) => request<void>(`${P(uid, pid)}/documents/${docId}`, { method: "DELETE" }),
  retryDocument: (uid: string, pid: string, docId: string) => json<{ document: DocumentRecord }>(`${P(uid, pid)}/documents/${docId}/retry`, "POST"),
  documentFileUrl: async (uid: string, pid: string, docId: string) => {
    const t = await token();
    // Local storage is served by the API with the token in a header; for a
    // browser <img> we fetch and hand back a blob URL instead.
    const res = await fetch(`${AGENT_URL}${P(uid, pid)}/documents/${docId}/file`, { headers: { Authorization: `Bearer ${t}` } });
    if (!res.ok) throw new ApiError(res.status, "file");
    return URL.createObjectURL(await res.blob());
  },

  /** One page of a stored bill as a PNG blob URL (PDFs are rendered by the agent). */
  documentPageUrl: async (uid: string, pid: string, docId: string, page = 1) => {
    const t = await token();
    const res = await fetch(`${AGENT_URL}${P(uid, pid)}/documents/${docId}/page/${page}`, { headers: { Authorization: `Bearer ${t}` } });
    if (!res.ok) throw new ApiError(res.status, "page");
    return URL.createObjectURL(await res.blob());
  },

  // reconcile and inventory (period)
  reconcileState: (uid: string, pid: string) => request<ReconcileState>(`${P(uid, pid)}/reconcile`),
  reconcileStart: (uid: string, pid: string) => json<ReconcileState>(`${P(uid, pid)}/reconcile/start`, "POST"),
  reconcileReply: (uid: string, pid: string, message: string) => json<ReconcileState>(`${P(uid, pid)}/reconcile`, "POST", { message }),
  compute: (uid: string, pid: string) => json<Snapshot>(`${P(uid, pid)}/compute`, "POST"),
  inventory: (uid: string, pid: string) =>
    request<{ lines: InventoryLine[]; snapshot: Snapshot | null; assumptions: Assumption[]; activityLines: ActivityLine[] }>(`${P(uid, pid)}/inventory`),
  patchLine: (uid: string, pid: string, lineId: string, patch: { quantity?: number; energy_type?: string; note?: string }) =>
    json<{ snapshot: Snapshot }>(`${P(uid, pid)}/activity-lines/${lineId}`, "PATCH", patch),
  advisor: (uid: string, pid: string, siteId?: string) =>
    request<AdvisorView>(`${P(uid, pid)}/advisor${siteId ? `?site_id=${encodeURIComponent(siteId)}` : ""}`),
  locateSite: (uid: string, siteId: string, body: { address?: string; roof_area_m2?: number }) =>
    json<SupplierProfile>(`/suppliers/${uid}/sites/${siteId}/locate`, "POST", body),
  methodology: (uid: string, pid: string) => request<{ download: string; bytes: number }>(`${P(uid, pid)}/methodology`),

  // questionnaire (request)
  fillQuestionnaire: async (uid: string, rid: string, file?: File | null, customerShare?: number) => {
    const fd = new FormData();
    if (file) fd.append("file", file);
    if (customerShare !== undefined && !Number.isNaN(customerShare)) fd.append("customer_share", String(customerShare));
    return request<{ questionnaire: QuestionnaireRecord; request: RequestView; download: string }>(`${R(uid, rid)}/questionnaire`, { method: "POST", body: fd });
  },
  getQuestionnaire: (uid: string, rid: string) => request<{ questionnaire: QuestionnaireRecord | null }>(`${R(uid, rid)}/questionnaire`),
  editAnswer: (uid: string, qid: string, questionId: string, value: string) =>
    json<{ questionnaire: QuestionnaireRecord }>(`/suppliers/${uid}/questionnaire/${qid}/answers/${questionId}`, "PATCH", { value }),
  questionnaireFilePath: (uid: string, qid: string) => `/suppliers/${uid}/questionnaire/${qid}/file`,

  /** Download a protected file by fetching with the token and saving via a blob link. */
  download: async (path: string, filename: string) => {
    const t = await token();
    const res = await fetch(`${AGENT_URL}${path}`, { headers: { Authorization: `Bearer ${t}` } });
    if (!res.ok) throw new ApiError(res.status, "download failed");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
};
