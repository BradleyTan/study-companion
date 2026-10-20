/**
 * Opens a student's file (a short-lived signed URL, served as a download) in a new tab.
 *
 * The URL only arrives after a server action, so the click's user activation may be gone by then:
 * Safari and iOS block `window.open` after an await, and Chrome after about 5 seconds. A blocked
 * call returns null, and then the file downloads in this tab instead (the response is an
 * attachment, so the page stays where it is). `noopener` can't be passed as a feature because it
 * makes `window.open` return null even when the tab did open; the opener is cut by hand instead.
 *
 * Only http(s) URLs (a Supabase signed URL, or the demo's same-origin `/api/demo-file/…`) are
 * followed. Anything else, such as `javascript:` or `data:`, is refused (polish-review.md S5-1).
 */
export function openFileUrl(url: string, win: Pick<Window, "open" | "location"> = window): "tab" | "here" | "refused" {
  let safe: string;
  try {
    const parsed = new URL(url, win.location.href);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "refused";
    safe = parsed.href;
  } catch {
    return "refused";
  }
  const tab = win.open(safe, "_blank");
  if (tab) {
    try { tab.opener = null; } catch { /* cross-origin tab: nothing to cut */ }
    return "tab";
  }
  win.location.assign(safe);
  return "here";
}
