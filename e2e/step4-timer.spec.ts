import { expect, test, type Page } from "@playwright/test";
import { createSubject, expectNoA11yViolations, expectNoHorizontalScroll, openSettings, smallTargets, startDemo } from "./helpers";

// Step 4 part 1: the study timer (docs/design/screens/timer.md). Time is driven by Playwright's
// fake clock, so a 25-minute round takes a moment and "background tab" means the clock jumped
// while nothing on the page was ticking.

const MIN = 60_000;
const chip = (page: Page) => page.getByTestId("timer-chip");
const panel = (page: Page) => page.getByRole("dialog", { name: "Study timer" });

/**
 * The fake clock starts six hours ago and keeps flowing, so rounds that end after a fast-forward are
 * still in the past for the server (it refuses rounds that "haven't ended yet").
 */
const PAST = () => Date.now() - 6 * 60 * MIN;
async function installClock(target: { clock: Page["clock"] }) {
  await target.clock.install({ time: PAST() });
}

async function openPanel(page: Page) {
  await chip(page).click();
  await expect(panel(page)).toBeVisible();
}

type Export = { studySessions: { kind: string; focusedSec: number; completed: boolean; subjectId: string | null; startedAt: string; endedAt: string; plannedSec: number }[]; profile: Record<string, unknown> };
async function exported(page: Page): Promise<Export> {
  return (await page.request.get("/api/export")).json();
}

test("start, pause, resume and stop from the panel", async ({ page }) => {
  await installClock(page);
  await startDemo(page);
  await expect(chip(page)).toHaveAccessibleName("Study timer, not running");
  await openPanel(page);
  await expect(page.getByRole("heading", { name: "Study timer" })).toBeFocused();
  const p = panel(page);
  await expect(p.getByRole("radio", { name: "Focus · 25" })).toBeChecked();
  await expect(p.getByRole("timer")).toHaveText("25:00");
  await expect(p.getByText("No rounds yet today. One round is 25 minutes. You've got this.")).toBeVisible();

  await p.getByRole("button", { name: "Start focus" }).click();
  await expect(page.getByTestId("timer-live")).toHaveText("Focus started: 25 minutes. Focus mode is on: sounds and animations are quieter.");
  await expect(page.locator("html")).toHaveAttribute("data-focus-mode", "");
  await expect(p.getByRole("radio", { name: "Focus · 25" })).toHaveCount(0); // phase switch hidden while running
  await page.clock.fastForward(2 * MIN);
  await expect(p.getByRole("timer")).toHaveText(/^(23:00|22:5\d)$/);
  await expect(chip(page)).toHaveText(/^(23:00|22:5\d)$/);
  await expect(chip(page)).toHaveAccessibleName(/^Study timer: focus, 2[23] minutes left$/);

  await p.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByTestId("timer-live")).toHaveText(/^Paused with 2[23] minutes left\.$/);
  await expect(chip(page)).toHaveAccessibleName(/^Study timer: paused, focus, 2[23] minutes left/);
  await expect(page.locator("html")).toHaveAttribute("data-focus-mode", ""); // still on while paused
  const pausedAt = await p.getByRole("timer").textContent();
  await page.clock.fastForward(30 * MIN);
  await expect(p.getByRole("timer")).toHaveText(pausedAt!);
  await p.getByRole("button", { name: "Resume" }).click();
  await page.clock.fastForward(MIN);
  await expect(p.getByRole("timer")).toHaveText(/^(22:00|21:5\d)$/);

  await p.getByRole("button", { name: "+5 min" }).click();
  await expect(p.getByRole("timer")).toHaveText(/^(27:00|26:5\d)$/);

  await p.getByRole("button", { name: "Stop" }).click();
  await expect(p.getByText("End this round? 3 min will be saved.")).toBeVisible();
  await p.getByRole("button", { name: "Keep going" }).click();
  await p.getByRole("button", { name: "Stop" }).click();
  await p.getByRole("button", { name: "End round" }).click();
  await expect(p.getByRole("button", { name: "Start focus" })).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-focus-mode", "");
  await expect(p.getByText("0 rounds · 3 min")).toBeVisible();
  await expect.poll(async () => (await exported(page)).studySessions).toMatchObject([{ kind: "focus", completed: false, subjectId: null }]);
  expect((await exported(page)).studySessions[0].focusedSec).toBeGreaterThanOrEqual(180);
  expect((await exported(page)).studySessions[0].focusedSec).toBeLessThan(240);

  // Under a minute isn't saved.
  await p.getByRole("button", { name: "Start focus" }).click();
  await page.clock.fastForward(30_000);
  await p.getByRole("button", { name: "Stop" }).click();
  await expect(p.getByText("End this round? It's under a minute, so it won't be saved.")).toBeVisible();
  await p.getByRole("button", { name: "End round" }).click();
  await expect(p.getByRole("button", { name: "Start focus" })).toBeVisible();
  expect((await exported(page)).studySessions).toHaveLength(1);

  // Esc closes the panel and focus goes back to the chip.
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect(chip(page)).toBeFocused();
});

test("wall-clock: a background tab keeps exact time, and the title shows it", async ({ page }) => {
  await installClock(page);
  await startDemo(page);
  await openPanel(page);
  await panel(page).getByRole("button", { name: "Start focus" }).click();
  // Hide the tab: nothing redraws while it's hidden; the time is endsAt − now when it comes back.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(10 * MIN + 400);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(panel(page).getByRole("timer")).toHaveText(/^(15:00|14:5\d)$/);
  await expect(page).toHaveTitle(/^(15:00|14:5\d) · Focus · StudyNest$/);
  await page.reload();
  // A reload picks up where the clock is (state in localStorage), before any network.
  await expect(chip(page)).toHaveText(/^1[45]:\d\d$/);
  await page.getByRole("link", { name: "StudyNest" }).click();
  await expect(page).toHaveURL(/\/subjects$/);
  await expect(chip(page)).toHaveText(/^1[45]:\d\d$/); // navigation never resets it
});

test("end card, round logging, long break after 4 and Done for now", async ({ page }) => {
  await installClock(page);
  await startDemo(page);
  await createSubject(page, "Biology", { emoji: "🧬" });
  await page.getByRole("link", { name: /Biology/ }).click();
  await openPanel(page);
  const p = panel(page);
  await expect(p.getByLabel("Studying")).toHaveValue(/[0-9a-f-]{36}/);
  await expect(p.getByLabel("Studying").locator("option:checked")).toHaveText("🧬 Biology");

  for (let round = 1; round <= 4; round++) {
    await p.getByRole("button", { name: "Start focus" }).click();
    await page.clock.fastForward(25 * MIN);
    const card = p.getByTestId("end-card");
    await expect(card.getByRole("heading", { name: "Round done! 🍅" })).toBeFocused();
    if (round < 4) {
      await expect(card).toContainText(`That's ${round} today. Time for a 5-minute break.`);
      await expect(chip(page)).toHaveText("Round done!");
      await expect(page.getByTestId("timer-live")).toHaveText("Round done! Time for a 5-minute break.");
      await card.getByRole("button", { name: "Skip break" }).click();
    } else {
      await expect(card).toContainText("Four in a row! Take a proper 15-minute break.");
      await expect(p.getByRole("img", { name: "Round 4 of 4" })).toBeVisible();
      await card.getByRole("button", { name: "Start break" }).click();
    }
  }
  await expect(page.locator("html")).not.toHaveAttribute("data-focus-mode", ""); // breaks aren't focus mode
  await expect(p.getByText("Long break", { exact: true })).toBeVisible();
  await expect(chip(page)).toHaveText(/1[45]:\d\d$/);
  await page.clock.fastForward(15 * MIN);
  await expect(p.getByTestId("end-card")).toContainText("Break's over");
  await expect(p.getByTestId("end-card")).toContainText("Ready for another round?");
  await p.getByRole("button", { name: "Done for now" }).click();
  await expect(p.getByRole("img", { name: "Round 1 of 4" })).toBeVisible();

  await expect(p.getByTestId("today-tally")).toContainText("4 rounds · 1 h 40 min");
  await expect(p.getByTestId("today-tally")).toContainText("Biology · 1 h 40 min");
  await expect(p.getByRole("img", { name: "4 tomatoes" })).toBeVisible();
  await expect.poll(async () => (await exported(page)).studySessions.length).toBe(5);
  const rows = (await exported(page)).studySessions;
  expect(rows.filter((r) => r.kind === "focus" && r.completed && r.focusedSec === 1500)).toHaveLength(4);
  expect(rows.filter((r) => r.kind === "long_break" && r.focusedSec === 900)).toHaveLength(1);
  for (const r of rows) expect(Date.parse(r.endedAt) - Date.parse(r.startedAt)).toBe(r.plannedSec * 1000);

  // The subject page study strip counts this week's focus time.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("study-strip")).toContainText("This week: 1 h 40 min studied");
});

test.describe("ended while away", () => {
  test.use({ timezoneId: "UTC" });
test("ended while away: logged at the end time, no chime, the panel says when it finished", async ({ page }) => {
  await installClock(page);
  await startDemo(page);
  await openPanel(page);
  await panel(page).getByRole("button", { name: "Start focus" }).click();
  await page.keyboard.press("Escape");
  // The tab is closed (no timer runs) and opened again three hours later.
  const stored = await page.evaluate(() => localStorage.getItem("studynest:timer"));
  const endsAt = JSON.parse(stored!).endsAt as number;
  await page.goto("about:blank");
  await page.clock.setSystemTime(endsAt + 3 * 60 * MIN);
  await page.goto("/subjects");
  await expect(chip(page)).toHaveText("Round done!");
  await openPanel(page);
  const card = panel(page).getByTestId("end-card");
  const at = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(endsAt));
  await expect(card).toContainText(`Your focus round finished at ${at}. Nice work!`);
  await expect.poll(async () => (await exported(page)).studySessions).toMatchObject([{ kind: "focus", completed: true, focusedSec: 1500, endedAt: new Date(endsAt).toISOString() }]);
});
});

test("several tabs: exactly one handles the end and the round is logged once", async ({ context }) => {
  await installClock(context);
  const a = await context.newPage();
  await startDemo(a);
  const b = await context.newPage();
  await b.goto("/settings");
  await openPanel(a);
  await panel(a).getByRole("button", { name: "Start focus" }).click();
  await expect(chip(b)).toHaveText(/^2[45]:\d\d$/); // the other tab follows through localStorage
  await context.clock.fastForward(25 * MIN + 500);
  await expect(chip(a)).toHaveText("Round done!");
  await expect(chip(b)).toHaveText("Round done!");
  await expect.poll(async () => (await exported(a)).studySessions.length).toBe(1);
  // Nothing else sneaks in later (a second tab, a retry).
  await context.clock.fastForward(MIN);
  await a.reload();
  await b.reload();
  await expect(chip(a)).toHaveText("Round done!");
  expect((await exported(b)).studySessions).toHaveLength(1);
  const handled = JSON.parse((await a.evaluate(() => localStorage.getItem("studynest:timer")))!).ended.handledBy;
  expect(typeof handled).toBe("string");
});

test("a failed save waits in this browser and is saved when back online", async ({ page, context }) => {
  await installClock(page);
  await startDemo(page);
  await openPanel(page);
  await panel(page).getByRole("button", { name: "Start focus" }).click();
  await context.setOffline(true);
  await page.clock.fastForward(25 * MIN);
  await expect(panel(page).getByTestId("end-card")).toBeVisible();
  await expect(panel(page).getByTestId("today-tally")).toContainText("1 round · 25 min"); // counted while queued
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("studynest:timer:queue") ?? "[]").length)).toBe(1);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => page.evaluate(() => localStorage.getItem("studynest:timer:queue"))).toBeNull();
  expect((await exported(page)).studySessions).toHaveLength(1);
});

test("settings: timer defaults, saving and the panel follows them", async ({ page }) => {
  await startDemo(page);
  await openSettings(page);
  const card = page.getByTestId("timer-settings");
  await expect(card.getByRole("group", { name: "Focus" }).locator("output")).toHaveText("25 min");
  await expect(card.getByRole("group", { name: "Short break" }).locator("output")).toHaveText("5 min");
  await expect(card.getByRole("group", { name: "Long break", exact: true }).locator("output")).toHaveText("15 min");
  await expect(card.getByRole("group", { name: "Long break after" }).locator("output")).toHaveText("4 rounds");
  await expect(card.getByLabel("Start the next round or break by itself")).not.toBeChecked();
  await expect(card.getByLabel("Quiet the app while I focus")).toBeChecked();
  await expect(card.getByText("On phones, the alert may only appear when you come back to StudyNest")).toBeVisible();
  await expectNoA11yViolations(page);

  await card.getByRole("button", { name: "Longer focus" }).click();
  await expect(page.getByText("Saved")).toBeVisible();
  await card.getByRole("button", { name: "Shorter short break" }).click();
  await card.getByLabel("Quiet the app while I focus").uncheck();
  await expect(card.getByRole("group", { name: "Focus" }).locator("output")).toHaveText("30 min");
  await page.reload();
  await expect(page.getByTestId("timer-settings").getByRole("group", { name: "Focus" }).locator("output")).toHaveText("30 min");
  await expect(page.getByTestId("timer-settings").getByRole("group", { name: "Short break" }).locator("output")).toHaveText("4 min");
  await expect(page.getByTestId("timer-settings").getByLabel("Quiet the app while I focus")).not.toBeChecked();
  expect((await exported(page)).profile).toMatchObject({ timerFocusMin: 30, timerShortMin: 4, focusQuiet: false });

  await openPanel(page);
  await expect(panel(page).getByRole("radio", { name: "Focus · 30" })).toBeChecked();
  await panel(page).getByRole("button", { name: "Start focus" }).click();
  await expect(panel(page).getByRole("timer")).toHaveText(/^(30:00|29:5\d)$/);
  await expect(page.locator("html")).not.toHaveAttribute("data-focus-mode", ""); // quiet is off
  // The stepper beside Start changes the default too (here for a short break).
  await panel(page).getByRole("button", { name: "Stop" }).click();
  await panel(page).getByRole("button", { name: "End round" }).click();
  await panel(page).getByText("Short break · 4").click();
  await panel(page).getByRole("button", { name: "Longer short break" }).click();
  await expect(panel(page).getByRole("radio", { name: "Short break · 5" })).toBeChecked();
});

test("subject: page subject by default, last used elsewhere, study strip starts and switches", async ({ page }) => {
  await installClock(page);
  await startDemo(page);
  await createSubject(page, "Biology", { emoji: "🧬" });
  await createSubject(page, "Law", { emoji: "⚖️" });
  // Not on a subject page and nothing used yet: No subject.
  await openPanel(page);
  await expect(panel(page).getByLabel("Studying").locator("option:checked")).toHaveText("No subject");
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: /Law/ }).click();
  const strip = page.getByTestId("study-strip");
  await expect(strip).toContainText("No focus rounds this week yet");
  await strip.getByRole("button", { name: "Start focus" }).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByLabel("Studying").locator("option:checked")).toHaveText("⚖️ Law");
  await page.keyboard.press("Escape");
  await expect(strip.getByRole("button", { name: /Focusing on Law, 2[45]:\d\d left/ })).toBeVisible();

  // On another subject's page the strip offers to switch the running round.
  await page.goto("/subjects");
  await page.getByRole("link", { name: /Biology/ }).click();
  await page.getByTestId("study-strip").getByRole("button", { name: "Switch timer to Biology" }).click();
  await expect(panel(page).getByLabel("Studying").locator("option:checked")).toHaveText("🧬 Biology");
  await page.clock.fastForward(25 * MIN);
  await expect(panel(page).getByTestId("today-tally")).toContainText("Biology · 25 min"); // logged under the final choice
  await panel(page).getByRole("button", { name: "Skip break" }).click();
  await page.keyboard.press("Escape");

  // Elsewhere, the last used subject is the default.
  await openSettings(page);
  await openPanel(page);
  await expect(panel(page).getByLabel("Studying").locator("option:checked")).toHaveText("🧬 Biology");
});

test("/timer: Space starts and pauses, axe passes, reduced motion steps the ring", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installClock(page);
  await startDemo(page);
  await page.goto("/timer");
  await expect(page.getByRole("heading", { name: "Study timer", level: 1 })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(page.getByRole("timer")).toHaveAccessibleName(/^Focus, (25 minutes|24 minutes 5\d seconds) left$/);
  const transition = await page.getByTestId("ring-band").evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(transition.split(",").every((d) => parseFloat(d) === 0)).toBe(true);
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
  await expect(page).toHaveTitle("Paused · StudyNest");
  await expectNoA11yViolations(page);
  // Chip on /timer doesn't open a second timer.
  await chip(page).click();
  await expect(panel(page)).toBeHidden();
});

test("the ring moves smoothly without reduced motion", async ({ page }) => {
  await startDemo(page);
  await page.goto("/timer");
  const transition = await page.getByTestId("ring-band").evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(transition).toContain("1s");
});

test.describe("phone (375 px)", () => {
  test.use({ viewport: { width: 375, height: 740 }, hasTouch: true, isMobile: true });

  test("header fits, the panel is a bottom sheet with 44 px targets", async ({ page }) => {
    await installClock(page);
    await startDemo(page);
    await expectNoHorizontalScroll(page);
    await expect(chip(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Menu" })).toBeVisible();
    await openPanel(page);
    const box = await panel(page).boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(370);
    expect(box!.y + box!.height).toBeGreaterThanOrEqual(735); // docked at the bottom
    await expect.poll(() => smallTargets(page)).toEqual([]); // after the sheet has slid in
    await panel(page).getByText("Short break · 5").click();
    await panel(page).getByRole("button", { name: "Start break" }).click();
    await expect(chip(page)).toHaveText(/^[45]:\d\d$/, { useInnerText: true }); // the word "Break" is dropped on phones
    await expect(chip(page)).toHaveAccessibleName(/^Study timer: short break, [45] minutes left$/);
    await expectNoA11yViolations(page);
    await page.getByRole("button", { name: "Close" }).click();
    await expectNoHorizontalScroll(page);
  });
});
