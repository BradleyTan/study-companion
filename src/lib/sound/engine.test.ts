import { describe, expect, it } from "vitest";
import { allowed, playSound } from "./engine";

describe("playSound", () => {
  it("is silent at volume 0 and outside a browser", () => {
    expect(playSound("click", 0)).toBe(false);
    expect(playSound("click", 0.5)).toBe(false); // no window/AudioContext in Node
  });
});

describe("allowed (sounds.md rules)", () => {
  const base = { soundOn: true, focusMode: false, speaking: false };
  it("plays nothing with sound off, not even the chime", () => {
    expect(allowed("chime", { ...base, soundOn: false })).toBe(false);
  });
  it("focus mode lets only the chime through", () => {
    expect(allowed("click", { ...base, focusMode: true })).toBe(false);
    expect(allowed("pop", { ...base, focusMode: true })).toBe(false);
    expect(allowed("chime", { ...base, focusMode: true })).toBe(true);
  });
  it("speech wins, except the read-aloud controls' click and the timer chime", () => {
    expect(allowed("pop", { ...base, speaking: true })).toBe(false);
    expect(allowed("click", { ...base, speaking: true })).toBe(false);
    expect(allowed("click", { ...base, speaking: true, duringSpeech: true })).toBe(true);
    expect(allowed("chime", { ...base, speaking: true })).toBe(true);
    expect(allowed("chime", { ...base, speaking: true, focusMode: true })).toBe(true);
  });
});
