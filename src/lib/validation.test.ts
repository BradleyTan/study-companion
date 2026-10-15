import { describe, expect, it } from "vitest";
import { makeFlashcardsInput, noteUpdate, settingsUpdate, subjectInput, uploadRequest } from "./validation";
import { formatBytes, timeAgo } from "./time";

const uuid = "5a000000-0000-4000-8000-000000000001";

describe("subjectInput", () => {
  it("trims names and accepts listed colours and emojis", () => {
    expect(subjectInput.parse({ name: "  Biology  ", colour: "sky", emoji: "🧬" })).toEqual({ name: "Biology", colour: "sky", emoji: "🧬" });
  });
  it("rejects blank or long names and unknown colours/emojis", () => {
    expect(subjectInput.safeParse({ name: "   ", colour: "sky", emoji: "🧬" }).success).toBe(false);
    expect(subjectInput.safeParse({ name: "x".repeat(61), colour: "sky", emoji: "🧬" }).success).toBe(false);
    expect(subjectInput.safeParse({ name: "Bio", colour: "red", emoji: "🧬" }).success).toBe(false);
    expect(subjectInput.safeParse({ name: "Bio", colour: "sky", emoji: "<script>" }).success).toBe(false);
  });
});

describe("uploadRequest", () => {
  it("caps size at 25 MB", () => {
    expect(uploadRequest.safeParse({ subjectId: uuid, fileName: "a.pdf", size: 25 * 1024 * 1024 }).success).toBe(true);
    const r = uploadRequest.safeParse({ subjectId: uuid, fileName: "a.pdf", size: 25 * 1024 * 1024 + 1 });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toBe("That file is over 25 MB.");
  });
  it("requires a real subject id", () => {
    expect(uploadRequest.safeParse({ subjectId: "../etc", fileName: "a.pdf", size: 10 }).success).toBe(false);
  });
});

describe("noteUpdate", () => {
  it("limits note length", () => {
    const ok = { id: uuid, title: "t", contentJson: { type: "doc" }, contentText: "x" };
    expect(noteUpdate.safeParse(ok).success).toBe(true);
    expect(noteUpdate.safeParse({ ...ok, contentText: "x".repeat(200_001) }).success).toBe(false);
  });
});

describe("settingsUpdate", () => {
  it("keeps volume between 0 and 1", () => {
    expect(settingsUpdate.safeParse({ volume: 1.5 }).success).toBe(false);
    expect(settingsUpdate.safeParse({ volume: 0.35, soundOn: false, theme: "dark" }).success).toBe(true);
  });
});

describe("time helpers", () => {
  it("formats relative times and sizes", () => {
    const now = Date.parse("2026-10-11T12:00:00Z");
    expect(timeAgo("2026-10-11T10:00:00Z", now)).toBe("2 hours ago");
    expect(timeAgo("2026-10-11T11:59:50Z", now)).toBe("just now");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(3.5 * 1024 * 1024)).toBe("3.5 MB");
  });
});

describe("makeFlashcardsInput page ranges", () => {
  const file = (pages: Record<string, unknown>) => makeFlashcardsInput.safeParse({ subjectId: uuid, source: { type: "file", id: uuid, ...pages }, count: 10 }).success;
  it("accepts a whole file or a range of up to 20 pages", () => {
    expect(file({})).toBe(true);
    expect(file({ fromPage: 7, toPage: 7 })).toBe(true);
    expect(file({ fromPage: 1, toPage: 20 })).toBe(true);
  });
  it("rejects one end only, backwards, over 20 pages, zero, fractions and strings", () => {
    expect(file({ fromPage: 3 })).toBe(false);
    expect(file({ toPage: 3 })).toBe(false);
    expect(file({ fromPage: 6, toPage: 5 })).toBe(false);
    expect(file({ fromPage: 1, toPage: 21 })).toBe(false);
    expect(file({ fromPage: 0, toPage: 5 })).toBe(false);
    expect(file({ fromPage: 1.5, toPage: 5 })).toBe(false);
    expect(file({ fromPage: "1", toPage: "5" })).toBe(false);
  });
});
