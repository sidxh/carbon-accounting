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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${await token()}`);
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

export interface ReconcileState {
  supplier_id: string;
  status: "idle" | "asking" | "done";
  issues: { id: string; kind: string; energy_type?: string | null; months: string[]; detail: string; resolved: boolean }[];
  pending_issue_id?: string | null;
  history: ChatTurn[];
  dropped_outside_fy: string[];
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
  filled_key?: string | null;
  answers: Answer[];
  status: string;
  created_at: string;
}

// --- calls ---------------------------------------------------------------------

export const api = {
  health: () => fetch(`${AGENT_URL}/health`).then((r) => r.json()),

  getSupplier: (uid: string) => request<SupplierProfile>(`/suppliers/${uid}`),
  upsertSupplier: (body: Omit<SupplierProfile, "id" | "sites"> & { sites: Omit<Site, "id">[] }) =>
    json<SupplierProfile>("/suppliers", "POST", body),

  /** "chat" keeps the bills and rebuilds lines from their extractions; "all" keeps only the profile. */
  resetData: (uid: string, scope: "chat" | "all") =>
    request<{ scope: string; activity_lines: number }>(`/suppliers/${uid}/data?scope=${scope}`, { method: "DELETE" }),

  listDocuments: (uid: string) => request<{ documents: DocumentRecord[] }>(`/suppliers/${uid}/documents`),
  uploadDocuments: async (uid: string, files: File[], siteId?: string) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    if (siteId) fd.append("site_id", siteId);
    return request<{ documents: DocumentRecord[] }>(`/suppliers/${uid}/documents`, { method: "POST", body: fd });
  },
  deleteDocument: (uid: string, docId: string) => request<void>(`/suppliers/${uid}/documents/${docId}`, { method: "DELETE" }),
  retryDocument: (uid: string, docId: string) => json<{ document: DocumentRecord }>(`/suppliers/${uid}/documents/${docId}/retry`, "POST"),
  documentFileUrl: async (uid: string, docId: string) => {
    const t = await token();
    // Local storage is served by the API with the token in a header; for a
    // browser <img> we fetch and hand back a blob URL instead.
    const res = await fetch(`${AGENT_URL}/suppliers/${uid}/documents/${docId}/file`, { headers: { Authorization: `Bearer ${t}` } });
    if (!res.ok) throw new ApiError(res.status, "file");
    return URL.createObjectURL(await res.blob());
  },

  reconcileState: (uid: string) => request<ReconcileState | null>(`/suppliers/${uid}/reconcile`),
  reconcileStart: (uid: string) => json<ReconcileState>(`/suppliers/${uid}/reconcile/start`, "POST"),
  reconcileReply: (uid: string, message: string) => json<ReconcileState>(`/suppliers/${uid}/reconcile`, "POST", { message }),

  compute: (uid: string) => json<Snapshot>(`/suppliers/${uid}/compute`, "POST"),
  inventory: (uid: string) =>
    request<{ lines: InventoryLine[]; snapshot: Snapshot | null; assumptions: Assumption[]; activityLines: ActivityLine[] }>(
      `/suppliers/${uid}/inventory`,
    ),
  patchLine: (uid: string, lineId: string, patch: { quantity?: number; energy_type?: string; note?: string }) =>
    json<{ snapshot: Snapshot }>(`/suppliers/${uid}/activity-lines/${lineId}`, "PATCH", patch),

  fillQuestionnaire: async (uid: string, file: File, customerShare?: number) => {
    const fd = new FormData();
    fd.append("file", file);
    if (customerShare !== undefined && !Number.isNaN(customerShare)) fd.append("customer_share", String(customerShare));
    return request<{ questionnaire: QuestionnaireRecord; download: string }>(`/suppliers/${uid}/questionnaire`, { method: "POST", body: fd });
  },
  listQuestionnaires: (uid: string) => request<{ questionnaires: QuestionnaireRecord[] }>(`/suppliers/${uid}/questionnaire`),
  editAnswer: (uid: string, qid: string, questionId: string, value: string) =>
    json<{ questionnaire: QuestionnaireRecord }>(`/suppliers/${uid}/questionnaire/${qid}/answers/${questionId}`, "PATCH", { value }),
  methodology: (uid: string) => request<{ download: string; bytes: number }>(`/suppliers/${uid}/methodology`),

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
