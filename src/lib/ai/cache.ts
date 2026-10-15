import { createHash } from "node:crypto";
import { PROMPT_VERSION } from "./prompts";

/**
 * Cache key for a generation: the kind, prompt version, options and the exact passages
 * (by content hash, in order). The same text with the same options always hits the cache;
 * any edit to the text, the selection or the options makes a new key.
 */
export function inputHash(kind: string, passageHashes: string[], options: Record<string, string | number | boolean> = {}): string {
  const opts = Object.keys(options).sort().map((k) => `${k}=${options[k]}`).join("&");
  return createHash("sha256")
    .update(`${kind}\nv${PROMPT_VERSION}\n${opts}\n${passageHashes.join("\n")}`)
    .digest("hex");
}
