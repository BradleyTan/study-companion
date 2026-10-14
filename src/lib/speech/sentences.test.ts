import { describe, expect, it } from "vitest";
import { findLoose } from "@/lib/text/find";
import { groupVoices, parsePrefs, pickVoice, splitSentences } from "./sentences";

describe("splitSentences", () => {
  it("splits sentences with offsets that point back into the text", () => {
    const text = "Cells are small. Smith said so!\nHeading\n\nWhy? Because.";
    const list = splitSentences(text);
    expect(list.map((s) => s.text)).toEqual(["Cells are small.", "Smith said so!", "Heading", "Why?", "Because."]);
    for (const s of list) expect(text.slice(s.start, s.end)).toBe(s.text);
  });

  it("skips empty and punctuation-only pieces", () => {
    expect(splitSentences("  \n...\n")).toEqual([]);
    expect(splitSentences("")).toEqual([]);
  });
});

const v = (name: string, lang: string, local: boolean) => ({ name, lang, voiceURI: name, localService: local });
const voices = [v("Zed (online)", "en-US", false), v("Amélie", "fr-FR", true), v("Daniel", "en-GB", true), v("Alex", "en_US", true), v("Google UK", "en-GB", false)];

describe("voices", () => {
  it("groups on-device voices before online ones, page language first", () => {
    const g = groupVoices(voices, "en");
    expect(g.onDevice.map((x) => x.name)).toEqual(["Alex", "Daniel", "Amélie"]);
    expect(g.online.map((x) => x.name)).toEqual(["Google UK", "Zed (online)"]);
  });

  it("defaults to the first on-device voice for the language, keeps a saved one, ignores a missing one", () => {
    expect(pickVoice(voices, null)?.name).toBe("Alex");
    expect(pickVoice(voices, "Google UK")?.name).toBe("Google UK");
    expect(pickVoice(voices, "Gone")?.name).toBe("Alex");
    expect(pickVoice([v("Online", "en", false)], null)?.name).toBe("Online");
    expect(pickVoice([], null)).toBeNull();
  });

  it("reads saved prefs defensively", () => {
    expect(parsePrefs(null)).toEqual({ voiceURI: null, rate: 1, autoReadCards: false });
    expect(parsePrefs("{bad")).toEqual({ voiceURI: null, rate: 1, autoReadCards: false });
    expect(parsePrefs(JSON.stringify({ voiceURI: "Daniel", rate: 1.5, autoReadCards: true }))).toEqual({ voiceURI: "Daniel", rate: 1.5, autoReadCards: true });
    expect(parsePrefs(JSON.stringify({ rate: 9 })).rate).toBe(1);
  });
});

describe("findLoose", () => {
  it("finds a quote across different whitespace and case", () => {
    const hay = "Intro.\n\nThe  Mitochondria\nmake ATP.";
    const r = findLoose(hay, "the mitochondria make atp");
    expect(r).not.toBeNull();
    expect(hay.slice(r!.start, r!.end)).toBe("The  Mitochondria\nmake ATP");
    expect(findLoose(hay, "chloroplast")).toBeNull();
    expect(findLoose(hay, "   ")).toBeNull();
  });
});
