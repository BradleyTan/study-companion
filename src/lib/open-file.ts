/**
 * Opens a student's file (a short-lived signed URL, served as a download) in a new tab.
 *
 * The URL only arrives after a server action, so the click's user activation may be gone by then:
 * Safari and iOS block `window.open` after an await, and Chrome after about 5 seconds. A blocked
 * call returns null, and then the file downloads in this tab instead (the response is an
 * attachment, so the page stays where it is). `noopener` can't be passed as a feature because it
 * makes `window.open` return null even when the tab did open; the opener is cut by hand instead.
 */
export function openFileUrl(url: string, win: Pick<Window, "open" | "location"> = window): "tab" | "here" {
  const tab = win.open(url, "_blank");
  if (tab) {
    try { tab.opener = null; } catch { /* cross-origin tab: nothing to cut */ }
    return "tab";
  }
  win.location.assign(url);
  return "here";
}
