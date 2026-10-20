import { describe, expect, it, vi } from "vitest";
import { openFileUrl } from "./open-file";

function fakeWindow(opened: { opener: unknown } | null) {
  return {
    open: vi.fn(() => opened as Window | null),
    location: { href: "https://app.test/subjects/1", assign: vi.fn() } as unknown as Location,
  };
}

describe("openFileUrl", () => {
  it("opens a new tab and cuts its opener", () => {
    const tab = { opener: {} as unknown };
    const w = fakeWindow(tab);
    expect(openFileUrl("https://x.test/f.pdf", w)).toBe("tab");
    expect(w.open).toHaveBeenCalledWith("https://x.test/f.pdf", "_blank");
    expect(tab.opener).toBeNull();
    expect(w.location.assign).not.toHaveBeenCalled();
  });

  it("downloads in this tab when a popup blocker refuses the new tab (Safari after an await)", () => {
    const w = fakeWindow(null);
    expect(openFileUrl("https://x.test/f.pdf", w)).toBe("here");
    expect(w.location.assign).toHaveBeenCalledWith("https://x.test/f.pdf");
  });

  it("keeps the PDF page fragment and resolves the demo's same-origin path", () => {
    const w = fakeWindow(null);
    expect(openFileUrl("/api/demo-file/abc#page=3", w)).toBe("here");
    expect(w.location.assign).toHaveBeenCalledWith("https://app.test/api/demo-file/abc#page=3");
  });

  it.each(["javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x", "blob:https://x.test/1"])(
    "refuses %s in both the tab and the fallback path (S5-1)",
    (url) => {
      for (const tab of [{ opener: {} }, null]) {
        const w = fakeWindow(tab);
        expect(openFileUrl(url, w)).toBe("refused");
        expect(w.open).not.toHaveBeenCalled();
        expect(w.location.assign).not.toHaveBeenCalled();
      }
    },
  );
});
