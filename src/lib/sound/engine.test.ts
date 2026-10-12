import { describe, expect, it } from "vitest";
import { playSound } from "./engine";

describe("playSound", () => {
  it("is silent at volume 0 and outside a browser", () => {
    expect(playSound("click", 0)).toBe(false);
    expect(playSound("click", 0.5)).toBe(false); // no window/AudioContext in Node
  });
});
