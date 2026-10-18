import { describe, expect, it } from "vitest";
import { matchFill, normaliseAnswer, numberForms, parseQuantity, withinOneEdit } from "./match";

const right = (given: string, answer: string, accepted: string[] = []) => matchFill(given, answer, accepted).correct;

describe("normaliseAnswer", () => {
  it("trims, lower-cases, removes diacritics and collapses spaces", () => {
    expect(normaliseAnswer("  Café   AU  lait ")).toBe("cafe au lait");
    expect(normaliseAnswer("Naïve")).toBe("naive");
  });
  it("drops a leading article and trailing punctuation", () => {
    expect(normaliseAnswer("The Mitochondria.")).toBe("mitochondria");
    expect(normaliseAnswer("an enzyme!?")).toBe("enzyme");
    expect(normaliseAnswer('"osmosis"')).toBe("osmosis");
  });
  it("keeps 'the' inside an answer", () => {
    expect(normaliseAnswer("over the membrane")).toBe("over the membrane");
  });
  it("is linear on long punctuation runs", () => {
    const t = performance.now();
    normaliseAnswer(`a${"!".repeat(50_000)}b`);
    expect(performance.now() - t).toBeLessThan(200);
  });
});

describe("matchFill: exact and normalised", () => {
  it("accepts the answer with any case, spacing, article or trailing punctuation", () => {
    expect(right("mitochondria", "mitochondria")).toBe(true);
    expect(right("  The MITOCHONDRIA. ", "mitochondria")).toBe(true);
    expect(right("ATP synthase", "ATP  synthase")).toBe(true);
  });
  it("accepts accents left off and accents added", () => {
    expect(right("Schrodinger", "Schrödinger")).toBe(true);
    expect(right("schrödinger", "Schrodinger")).toBe(true);
  });
  it("rejects a different word and empty input", () => {
    expect(right("ribosome", "mitochondria")).toBe(false);
    expect(right("", "mitochondria")).toBe(false);
    expect(right("   ", "mitochondria")).toBe(false);
    expect(right("the", "mitochondria")).toBe(false);
  });
  it("accepts an accepted alternative", () => {
    expect(right("ATP", "adenosine triphosphate", ["ATP"])).toBe(true);
    expect(matchFill("atp", "adenosine triphosphate", ["ATP"]).expected).toBe("ATP");
    expect(right("ADP", "adenosine triphosphate", ["ATP"])).toBe(false);
  });
  it("treats a hyphen and a space the same", () => {
    expect(right("alpha helix", "alpha-helix")).toBe(true);
  });
});

describe("matchFill: singular and plural of the last word", () => {
  it.each([
    ["cell", "cells"], ["cells", "cell"], ["enzymes", "enzyme"], ["species", "species"],
    ["mitochondrion", "mitochondria"], ["bacteria", "bacterium"], ["nucleus", "nuclei"], ["nuclei", "nucleus"],
    ["glucose molecule", "glucose molecules"], ["bodies", "body"], ["analysis", "analyses"], ["matrices", "matrix"],
  ])("%s ~ %s", (given, answer) => {
    expect(right(given, answer)).toBe(true);
  });
  it("only the last word may change number", () => {
    expect(right("cells walls", "cell wall")).toBe(false);
    // The typo allowance is for one word of 6+ letters ("cell" is too short), so this is a miss.
    expect(right("cells wall", "cell wall")).toBe(false);
    expect(matchFill("plasma membrnae", "plasma membrane").typo).toBe(true);
  });
  it("short words don't get plural forms that turn them into other words", () => {
    expect(numberForms("is").has("i")).toBe(false);
    expect(right("as", "a")).toBe(false);
  });
});

describe("matchFill: numbers and units", () => {
  it("compares numbers by value", () => {
    expect(right("25", "25")).toBe(true);
    expect(right("25.0", "25")).toBe(true);
    expect(right("1,200", "1200")).toBe(true);
    expect(right("0.5", ".5")).toBe(true);
    expect(right("2,5", "2.5")).toBe(true);
    expect(right("26", "25")).toBe(false);
    expect(right("-70", "70")).toBe(false);
  });
  it("needs the unit when the answer has one, written any common way", () => {
    expect(right("25 °C", "25°C")).toBe(true);
    expect(right("25°C", "25 °C")).toBe(true);
    expect(right("25 degrees C", "25 °C")).toBe(true);
    expect(right("25 degrees celsius", "25 °C")).toBe(true);
    expect(right("25", "25 °C")).toBe(false);
    expect(right("25 °F", "25 °C")).toBe(false);
    expect(right("−70 mV", "-70 mV")).toBe(true);
    expect(right("-70 millivolts", "-70 mV")).toBe(true);
    expect(right("-70 V", "-70 mV")).toBe(false);
    expect(right("45 percent", "45%")).toBe(true);
    expect(right("30 µm", "30 μm")).toBe(true);
    expect(right("30 mm", "30 μm")).toBe(false);
  });
  it("accepts a unit added to an answer without one", () => {
    expect(right("7 days", "7")).toBe(true);
  });
  it("never accepts a typo in a number", () => {
    expect(right("1201", "1200")).toBe(false);
    expect(right("H2O", "H20")).toBe(false);
  });
  it("parses quantities", () => {
    expect(parseQuantity("25 °C")).toEqual({ value: 25, unit: "°c" });
    expect(parseQuantity("-70mV")).toEqual({ value: -70, unit: "mv" });
    expect(parseQuantity("3 billion years of history in a long phrase")).toBeNull();
    expect(parseQuantity("photosynthesis")).toBeNull();
  });
});

describe("matchFill: one typo for longer words", () => {
  it("accepts one wrong, missing, extra or swapped letter in answers of 6+ letters", () => {
    for (const given of ["mitochondira", "mitochondri", "mitochondriaa", "mitochandria", "mitochnodria"]) {
      const m = matchFill(given, "mitochondria");
      expect(m.correct, given).toBe(true);
      expect(m.typo, given).toBe(true);
      expect(m.expected).toBe("mitochondria");
    }
  });
  it("rejects two typos", () => {
    expect(right("mitokondira", "mitochondria")).toBe(false);
  });
  it("gives no typo allowance to short answers", () => {
    expect(right("ATG", "ATP")).toBe(false);
    expect(right("cel", "cell")).toBe(false);
    expect(right("osmsis", "osmosis")).toBe(true); // 7 letters
    expect(right("lipd", "lipid")).toBe(false); // 5 letters
  });
  it("never accepts a different science term one letter away (QA step 3)", () => {
    const pairs: [string, string][] = [
      ["afferent", "efferent"], ["efferent", "afferent"], ["absorption", "adsorption"], ["nitrate", "nitrite"], ["sulfate", "sulfite"],
      ["chloride", "chlorine"], ["ethane", "ethene"], ["ethene", "ethyne"], ["alkane", "alkene"], ["propane", "propene"],
      ["nucleotide", "nucleoside"], ["cytosine", "cytokine"], ["ligase", "lipase"], ["insulin", "inulin"], ["inulin", "insulin"],
      ["isotonic", "isotopic"], ["neutron", "neuron"], ["neuron", "neutron"], ["lactose", "lactase"], ["maltase", "maltose"],
      ["sucrose", "sucrase"], ["dilute", "diluted"], ["proton", "photon"], ["phosphate", "phosphite"],
      ["S phase", "M phase"], ["vitamin D", "vitamin E"], ["β-cells", "α-cells"], ["type 1", "type 2"],
      ["hypotonic", "hypertonic"], ["hypertonic", "hypotonic"], ["meiosis", "mitosis"], ["mitosis", "meiosis"],
      ["exocytosis", "endocytosis"], ["haploid", "diploid"], ["anion", "cation"], ["lysosome", "lysozyme"], ["xylem", "phloem"],
      ["tRNA", "mRNA"], ["G1", "G2"], ["37 °C", "38 °C"], ["-70 mV", "70 mV"], ["7.35", "7.45"], ["30 μm", "30 mm"],
    ];
    for (const [given, answer] of pairs) expect(right(given, answer), `${given} for ${answer}`).toBe(false);
  });
  it("still forgives common misspellings (QA step 3)", () => {
    for (const [given, answer] of [
      ["hypothalmus", "hypothalamus"], ["photosynthsis", "photosynthesis"], ["glycolisis", "glycolysis"], ["mitochondira", "mitochondria"],
      ["chlorophyl", "chlorophyll"], ["cytoplasm", "cytoplasm"], ["phospholipd bilayer", "phospholipid bilayer"], ["Golgi aparatus", "Golgi apparatus"],
      ["endoplasmic retculum", "endoplasmic reticulum"], ["acetylcholine", "acetylcholine"],
    ]) expect(right(given, answer), `${given} for ${answer}`).toBe(true);
  });
  it("counts a number word as its number", () => {
    expect(right("five", "5")).toBe(true);
    expect(right("5", "Five")).toBe(true);
    expect(right("four", "5")).toBe(false);
  });
  it("marks an exact match as no typo", () => {
    expect(matchFill("osmosis", "osmosis").typo).toBe(false);
  });
  it("edit distance helper", () => {
    expect(withinOneEdit("abc", "abc")).toBe(true);
    expect(withinOneEdit("abc", "abd")).toBe(true);
    expect(withinOneEdit("abc", "ab")).toBe(true);
    expect(withinOneEdit("abc", "bac")).toBe(true);
    expect(withinOneEdit("abc", "cba")).toBe(false);
    expect(withinOneEdit("abc", "abcde")).toBe(false);
  });
});
