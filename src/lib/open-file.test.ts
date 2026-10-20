import { describe, expect, it, vi } from "vitest";
import { openFileUrl } from "./open-file";

function fakeWindow(opened: { opener: unknown } | null) {
  return { open: vi.fn(() => opened as Window | null), location: { assign: vi.fn() } as unknown as Location };
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
});
