import { unzipSync } from "fflate";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
};

const ext = (name: string) => name.toLowerCase().split(".").pop() ?? "";
const baseName = (path: string) => path.split("/").pop() ?? path;

/** The type a bill file is sent with: its own, or one worked out from its extension. */
function billType(name: string, type: string): string | null {
  if (type.startsWith("image/") || type === "application/pdf") return type;
  return MIME[ext(name)] ?? null;
}

const isZip = (f: File) => ext(f.name) === "zip" || f.type === "application/zip" || f.type === "application/x-zip-compressed";

/** Zip entries that are not the bills themselves: macOS resource forks, hidden files, folders. */
const skippable = (path: string) => path.endsWith("/") || path.split("/").some((p) => p.startsWith(".") || p === "__MACOSX");

export type Expanded = { files: File[]; skipped: number };

/**
 * Turn what the user chose or dropped into bills: images and PDFs pass through, a zip is opened
 * here in the browser and its images and PDFs are taken out, anything else is counted as skipped.
 * The agent still only ever receives single images and PDFs.
 */
export async function expandBillFiles(list: File[]): Promise<Expanded> {
  const files: File[] = [];
  let skipped = 0;
  for (const f of list) {
    if (isZip(f)) {
      let entries: Record<string, Uint8Array>;
      try {
        entries = unzipSync(new Uint8Array(await f.arrayBuffer()), { filter: (e) => !skippable(e.name) && billType(e.name, "") !== null });
      } catch {
        skipped += 1;
        continue;
      }
      for (const [path, bytes] of Object.entries(entries)) {
        const name = baseName(path);
        // Copy into a fresh buffer: File wants an ArrayBuffer-backed view.
        files.push(new File([new Uint8Array(bytes)], name, { type: billType(name, "") ?? "", lastModified: f.lastModified }));
      }
      continue;
    }
    const type = billType(f.name, f.type);
    if (type && !skippable(f.name)) files.push(type === f.type ? f : new File([f], f.name, { type, lastModified: f.lastModified }));
    else skipped += 1;
  }
  return { files, skipped };
}

type FsEntry = { isFile: boolean; isDirectory: boolean; name: string; file?: (ok: (f: File) => void, err: (e: unknown) => void) => void; createReader?: () => { readEntries: (ok: (e: FsEntry[]) => void, err: (e: unknown) => void) => void } };

async function walk(entry: FsEntry, out: File[]): Promise<void> {
  if (entry.isFile && entry.file) {
    const f = await new Promise<File>((ok, err) => entry.file!(ok, err));
    out.push(f);
  } else if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    // readEntries returns at most ~100 at a time; keep reading until it comes back empty.
    for (;;) {
      const batch = await new Promise<FsEntry[]>((ok, err) => reader.readEntries(ok, err));
      if (!batch.length) break;
      for (const e of batch) await walk(e, out);
    }
  }
}

/** Everything in a drop, including the contents of any folders dragged in. */
export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = Array.from(dt.items ?? [])
    .map((i) => (i.kind === "file" ? ((i as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.() ?? null) : null));
  if (!entries.length || entries.some((e) => !e)) return Array.from(dt.files);
  const out: File[] = [];
  for (const e of entries) await walk(e as FsEntry, out);
  return out;
}
