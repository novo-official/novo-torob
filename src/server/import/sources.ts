import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import yauzl from "yauzl";

export const CSV_NAMES = ["products", "offers", "shops"] as const;
export type CsvName = (typeof CSV_NAMES)[number];

export type SourceSpec = { kind: "zip"; path: string } | { kind: "dir"; path: string } | { kind: "fixture"; path: string };

export interface CsvSource {
  kind: SourceSpec["kind"];
  location: string;
  open(name: CsvName): Promise<Readable>;
  /** SHA-256 of the archive (zip only) for provenance. */
  sha256(): Promise<string | null>;
  close(): Promise<void>;
}

const MAX_ENTRY_BYTES = 2 * 1024 ** 3; // sanity cap against decompression bombs
const ENTRY_RE = /^(?:[^/]+\/)?(products|offers|shops)\.csv$/;

export async function openSource(spec: SourceSpec): Promise<CsvSource> {
  return spec.kind === "zip" ? openZip(spec.path) : openDir(spec);
}

function openDir(spec: Extract<SourceSpec, { kind: "dir" | "fixture" }>): CsvSource {
  const root = fs.realpathSync(spec.path);
  return {
    kind: spec.kind,
    location: root,
    async open(name) {
      const file = fs.realpathSync(path.join(root, `${name}.csv`));
      if (path.dirname(file) !== root) throw new Error(`Refusing to read ${file}: outside source directory`); // symlink escape
      return fs.createReadStream(file); // read-only stream; source bytes are never modified
    },
    async sha256() {
      return null;
    },
    async close() {},
  };
}

/**
 * Stream CSVs straight out of the ZIP (nothing is extracted to disk).
 * Defences: entry names are validated by yauzl (no absolute paths, no "..", no backslashes);
 * only exact `[dir/]{products,offers,shops}.csv` entries are used (`__MACOSX/` resource forks are ignored);
 * each name must be unique; declared uncompressed sizes are capped.
 */
function openZip(zipPath: string): Promise<CsvSource> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false, validateEntrySizes: true, decodeStrings: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error("cannot open zip"));
      const found = new Map<CsvName, yauzl.Entry>();
      zip.on("error", reject);
      zip.on("entry", (entry: yauzl.Entry) => {
        const bad = yauzl.validateFileName(entry.fileName);
        if (bad) {
          zip.close();
          return reject(new Error(`Unsafe ZIP entry "${entry.fileName}": ${bad}`));
        }
        if (entry.fileName.startsWith("__MACOSX/")) return zip.readEntry();
        const m = ENTRY_RE.exec(entry.fileName);
        if (m) {
          const name = m[1] as CsvName;
          if (found.has(name)) {
            zip.close();
            return reject(new Error(`Ambiguous ZIP: more than one ${name}.csv`));
          }
          if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
            zip.close();
            return reject(new Error(`ZIP entry ${entry.fileName} too large (${entry.uncompressedSize} bytes)`));
          }
          found.set(name, entry);
        }
        zip.readEntry();
      });
      zip.on("end", () => {
        const missing = CSV_NAMES.filter((n) => !found.has(n));
        if (missing.length) {
          zip.close();
          return reject(new Error(`ZIP is missing: ${missing.map((n) => `${n}.csv`).join(", ")}`));
        }
        resolve({
          kind: "zip",
          location: path.resolve(zipPath),
          open: (name) =>
            new Promise((res, rej) => {
              zip.openReadStream(found.get(name)!, (e, stream) => (e || !stream ? rej(e ?? new Error("no stream")) : res(stream)));
            }),
          sha256: () =>
            new Promise((res, rej) => {
              const h = crypto.createHash("sha256");
              fs.createReadStream(zipPath).on("data", (c) => h.update(c)).on("end", () => res(h.digest("hex"))).on("error", rej);
            }),
          close: async () => zip.close(),
        });
      });
      zip.readEntry();
    });
  });
}
