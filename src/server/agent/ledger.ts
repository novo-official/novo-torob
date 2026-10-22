/**
 * Per-turn evidence ledger. Every tool registers the NUMBERS it actually returned (prices, distances, counts) and a few
 * claim flags (e.g. an unconditional-cheapest verdict). The grounding validator later rejects any assistant text that states a
 * number or claim the ledger does not contain.
 */
export class Ledger {
  readonly numbers = new Set<number>();
  readonly flags = new Set<string>();
  readonly refs: Array<{ ref: string; label: string }> = [];
  readonly untrustedTexts: string[] = [];

  num(...ns: Array<number | null | undefined>): void {
    for (const n of ns) if (typeof n === "number" && Number.isFinite(n)) { this.numbers.add(n); this.numbers.add(Math.round(n)); }
  }
  /** a distance in metres also allows its kilometre rendering (1.2 km) and rounded forms */
  meters(m: number | null | undefined): void {
    if (typeof m !== "number" || !Number.isFinite(m)) return;
    this.num(m, Math.round(m), Math.round(m / 10) * 10, Math.round(m / 100) * 100);
    this.num(Math.round((m / 1000) * 10) / 10, Math.round(m / 1000));
  }
  flag(f: string): void { this.flags.add(f); }
  ref(ref: string, label: string): void { if (this.refs.length < 200) this.refs.push({ ref, label }); }
  /** text coming from untrusted sources (titles, external passages): used by tests to prove it never reaches the answer as an instruction */
  untrusted(t: string): void { if (this.untrustedTexts.length < 200) this.untrustedTexts.push(t); }
}
