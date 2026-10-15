import { quotaLabel, type Quota } from "@/lib/limits/ai";

/** "3 of 5 left today": always the full sentence, red at 0. */
export function QuotaChip({ quota, id }: { quota: Pick<Quota, "left" | "limit">; id?: string }) {
  return (
    <span id={id} data-testid="quota-chip" className={`chip ${quota.left === 0 ? "chip-limit" : ""}`}>
      {quotaLabel(quota)}
    </span>
  );
}
