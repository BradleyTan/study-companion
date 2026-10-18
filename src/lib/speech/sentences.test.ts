import { describe, expect, it } from "vitest";
import { findLoose, findPassage } from "@/lib/text/find";
import { groupVoices, parsePrefs, pickVoice, speakable, splitSentences } from "./sentences";

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

describe("findPassage", () => {
  const hay = "Mitochondria make ATP for the cell.\nRibosomes build proteins from amino acids.\nOther text.";
  it("finds a passage whose first line is the note title", () => {
    const r = findPassage(hay, "Cell structure\n\nMitochondria make ATP for the cell.\nRibosomes build proteins from amino acids.");
    expect(r && hay.slice(r.start, r.end)).toBe("Mitochondria make ATP for the cell.\nRibosomes build proteins from amino acids.");
  });
  it("still finds the part of a passage that survived an edit", () => {
    const r = findPassage(hay, "Gone paragraph that was deleted.\nRibosomes build proteins from amino acids.");
    expect(r && hay.slice(r.start, r.end)).toBe("Ribosomes build proteins from amino acids.");
  });
  it("returns null when nothing matches", () => {
    expect(findPassage(hay, "Something else entirely here.")).toBeNull();
  });
});

describe("speakable (science notation read aloud)", () => {
  it("spells out formulas, charges, powers, equations, Greek letters and units", () => {
    expect(speakable("C₆H₁₂O₆")).toBe("C 6 H 12 O 6");
    expect(speakable("Ca²⁺ and HCO₃⁻ and H⁺")).toBe("Ca 2 plus and HCO 3 minus and H plus");
    expect(speakable("E = mc²")).toBe("E equals mc squared");
    expect(speakable("3.0 × 10⁸ m/s")).toBe("3.0 times 10 to the power 8 m/s");
    expect(speakable("5.5 mmol·L⁻¹")).toBe("5.5 mmol L to the power minus 1");
    expect(speakable("10⁻³ M and 10²³")).toBe("10 to the power minus 3 M and 10 to the power 23");
    expect(speakable("ΔG = ΔH − TΔS")).toBe("delta G equals delta H minus T delta S");
    expect(speakable("H₂CO₃ ⇌ H⁺ + HCO₃⁻")).toBe("H 2 CO 3 is in equilibrium with H plus + HCO 3 minus");
    expect(speakable("6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂")).toBe("6CO 2 + 6H 2 O gives C 6 H 12 O 6 + 6O 2");
    expect(speakable("The α-helix and β-sheets")).toBe("The alpha -helix and beta -sheets");
    expect(speakable("−70 mV at 37 °C, pH 7.35–7.45, cells 10–30 µm")).toBe("minus 70 mV at 37 degrees Celsius, pH 7.35 to 7.45, cells 10 to 30 micrometres");
    expect(speakable("pH = −log[H⁺]")).toBe("pH equals minus log concentration of H plus");
    expect(speakable("Plain sentence, nothing to change.")).toBe("Plain sentence, nothing to change.");
  });
});
