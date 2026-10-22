import { deriveOutcome, type InquiryContext, type InquiryOutcome } from "@/domain/inquiry";
import {
  activeInquiry, isDismissed, missionPhase, readiness, triggersOf,
  type MissionPhase, type Readiness, type RecoveryTrigger, type ShoppingMissionV1,
} from "@/domain/mission";

export interface MissionView {
  /** MANUAL-only outcome (a simulated demo outcome can never be built from a mission) */
  outcome: InquiryOutcome | null;
  /** triggers that are active for the CURRENT shop/offer and not dismissed */
  triggers: RecoveryTrigger[];
  allTriggers: RecoveryTrigger[];
  readiness: Readiness;
  phase: MissionPhase;
}

/** everything the UI derives from (mission + freshly re-derived dataset context). Pure and deterministic. */
export function deriveMissionView(m: ShoppingMissionV1, ctx: InquiryContext | null): MissionView {
  const inq = activeInquiry(m);
  const outcome = ctx && m.shop && ctx.offer.id === m.shop.offerId
    ? deriveOutcome(ctx, { status: inq?.status ?? "DRAFT", replies: inq?.replies ?? [], nextAction: inq?.nextAction ?? null, previous: inq?.previous ?? null }, "MANUAL")
    : null;
  const all = triggersOf({ flags: outcome?.flags ?? [], inquiryStatus: inq?.status ?? null, hoursState: ctx?.hours.state ?? null });
  const triggers = all.filter((t) => !isDismissed(m, t));
  const r = readiness(m, { hoursState: ctx?.hours.state ?? null, blocksExactConfirmation: outcome?.blocksExactConfirmation ?? false, triggers: all });
  return { outcome, triggers, allTriggers: all, readiness: r, phase: missionPhase(m, r.ready) };
}
