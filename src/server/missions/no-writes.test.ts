// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = [...walk("src/server/missions"), ...walk("src/app/api/missions")].filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"));

describe("missions have NO server write path (they live in the browser)", () => {
  it("the mission server code and routes contain no SQL writes, filesystem writes, POST/PUT/DELETE handlers, or telephony/messaging", () => {
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\s+(INTO|TABLE|FROM|INDEX)?\b[^\n]*\b(offers|shops|products|import_runs|quality_flags)/i);
      expect(src, f).not.toMatch(/writeFile|appendFile|createWriteStream|rmSync|unlinkSync|\.exec\(\s*["'`](?:INSERT|UPDATE|DELETE)/i);
      expect(src, f).not.toMatch(/export\s+(?:async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b/);
      expect(src, f).not.toMatch(/\bphone\b|tel:|sms:|whatsapp|fetch\(/i);
    }
  });
  it("the shared read connection is opened read-only", () => {
    expect(fs.readFileSync("src/server/db/connect.ts", "utf8")).toMatch(/readOnly:\s*true/);
  });
});
