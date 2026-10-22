import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * OWNER RULE (Phase 9): the automated suite must make ZERO real network requests — in particular none to a paid model endpoint.
 * The global `fetch` is replaced by a guard: tests that need HTTP inject their own transport (`fetchImpl`) or spy on fetch explicitly.
 * Any accidental real call fails the test loudly instead of leaving the machine.
 */
beforeAll(() => {
  const guard = (async (input: RequestInfo | URL) => { throw new Error(`unit tests must not use the real network: ${String(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url).slice(0, 80)}`); }) as typeof fetch;
  Object.defineProperty(globalThis, "fetch", { value: guard, configurable: true, writable: true });
});

afterEach(() => cleanup());
