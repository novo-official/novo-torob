import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const lines = (p: string) => read(p).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
const instructions = (p: string) => lines(p).map((l) => l.split(/\s+/)[0]!.toUpperCase());

describe("deployment templates (config only — nothing is deployed)", () => {
  it("local Dockerfile keeps its proven runtime mode (VOLUME /data)", () => {
    expect(lines("Dockerfile")).toContain("VOLUME /data");
  });

  it("Liara Dockerfile has no VOLUME instruction and keeps the data dir under WORKDIR", () => {
    expect(instructions("deploy/liara/Dockerfile.liara")).not.toContain("VOLUME");
    const df = read("deploy/liara/Dockerfile.liara");
    expect(df).toMatch(/^WORKDIR \/app$/m);
    expect(df).toMatch(/DATABASE_PATH=\/app\/data\/app\.sqlite/);
    expect(df).not.toMatch(/COPY[^\n]*(\.data|app\.sqlite|\.zip)/);
    expect(df).toMatch(/REQUIRE_MIN_PRODUCTS=225903/); // a fixture database must never be served as the real catalog
  });

  it("liara.json example mounts the disk at an absolute path under WORKDIR, never over the code", () => {
    const j = JSON.parse(read("deploy/liara/liara.json.example")) as { disks: Array<{ name: string; mountTo: string }>; port: number; replicas?: number };
    expect(j.disks).toHaveLength(1);
    const to = j.disks[0]!.mountTo;
    expect(to.startsWith("/app/")).toBe(true);
    expect(["/", "/app", "/app/"]).not.toContain(to);
    expect(to).toBe("/app/data");
    expect(j.disks[0]!.name).toMatch(/^<.*>$/); // a placeholder, never an invented disk id
    expect(j.port).toBe(3000);
    expect(j.replicas).toBeUndefined(); // single instance until rate limiting is shared
  });

  it.each([".dockerignore", ".liaraignore"])("%s keeps data, secrets and test artifacts out of the build/upload context", (f) => {
    const l = lines(f).map((x) => x.replace(/^\//, "")); // anchored (/data) and bare (data) spellings both count
    for (const x of [".data", "data", ".env", "*.sqlite", "**/*.sqlite", "*.zip", "qa-artifacts", "test-results", ".claude"]) expect(l, `${f} must exclude ${x}`).toContain(x);
  });

  it(".liaraignore never drops source directories: data/.data/.cache/.next must be root-anchored (a bare `data` removed src/app/data from the Liara build)", () => {
    const l = lines(".liaraignore");
    for (const x of ["data", ".data", ".cache", ".next", "coverage", "test-results", "qa-artifacts"]) expect(l, `bare "${x}" matches at any depth`).not.toContain(x);
    for (const x of ["/data", "/.data", "/.cache", "/.next"]) expect(l).toContain(x);
    expect(fs.existsSync(path.join(ROOT, "src/app/data/page.tsx"))).toBe(true);
  });

  it(".gitignore keeps the dataset, databases, env files and QA artifacts out of Git", () => {
    const l = lines(".gitignore");
    for (const x of [".data/", "/data/", "*.sqlite", ".env", "/qa-artifacts/", "*.zip"]) expect(l).toContain(x);
  });

  it("live model calls stay code-locked and no template enables a key or a provider", async () => {
    const { LIVE_MODEL_CALLS_ENABLED_IN_CODE } = await import("../agent/live-gate");
    expect(LIVE_MODEL_CALLS_ENABLED_IN_CODE).toBe(false);
    for (const f of ["deploy/liara/Dockerfile.liara", "deploy/liara/liara.json.example", "docker-compose.yml"]) {
      expect(read(f)).not.toMatch(/AGENT_API_KEY\s*[:=]\s*\S|openai-compatible/);
    }
  });

  it("automated QA writes screenshots/reports outside the tracked docs/qa set", () => {
    const offenders: string[] = [];
    for (const dir of ["e2e", "scripts"]) {
      for (const f of fs.readdirSync(path.join(ROOT, dir))) {
        if (!/\.(ts|mjs|sh)$/.test(f)) continue;
        const code = read(`${dir}/${f}`).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*|#)/.test(l));
        if (code.some((l) => /["'`]docs\/qa/.test(l))) offenders.push(`${dir}/${f}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
