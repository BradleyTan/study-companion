import { expect, test, type Page } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalScroll, openSettings, smallTargets, startDemo } from "./helpers";

// Step 4 QA (docs/qa/step-4.md): daylight saving weeks with a Sunday week start, a real-world
// Outlook export (Windows zone names) seen from another time zone at 375 px, and the focus view
// on a phone in dark mode. The dates are fixed: a fixed week is what makes the clock change land
// inside it.

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const plus = (date: string, days: number) => iso(Date.parse(`${date}T00:00:00Z`) + days * DAY);
const ics = (date: string) => date.replaceAll("-", "");
/** Monday of the week `weeks` from now (UTC). */
function monday(weeks: number): string {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const back = (new Date(today).getUTCDay() + 6) % 7;
  return iso(today - back * DAY + weeks * 7 * DAY);
}

async function openTimetable(page: Page, week: string) {
  await page.goto(`/timetable?week=${week}`);
  await expect(page.getByRole("heading", { name: "Timetable", level: 1 })).toBeVisible();
  await expect(page.getByTestId("week-grid")).toBeVisible();
}

test.describe("London, Sunday week start, clocks go forward", () => {
  test.use({ timezoneId: "Europe/London" });

  test("a weekly 10:00 class stays at 10:00 across the change; the feed keeps the zone", async ({ page, isMobile }) => {
    test.skip(isMobile, "The phone day strip is covered below; this checks the whole week.");
    await startDemo(page);
    await openSettings(page);
    const section = page.getByRole("region", { name: "Timetable and calendar" });
    await expect(section.getByText(/Times are shown in Europe\/London/)).toBeVisible();
    await section.getByText("Sunday", { exact: true }).click();
    await expect(page.getByText("Saved")).toBeVisible();

    // British Summer Time starts on Sunday 28 March 2027 at 01:00.
    await openTimetable(page, "2027-03-21");
    await expect(page.locator("section.tt-day").first()).toHaveAttribute("aria-label", "Sunday 21 March");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const f = page.getByRole("dialog", { name: "New slot" });
    await f.getByLabel("Title").fill("Lecture");
    await f.getByLabel("Day").fill("2027-03-22");
    await f.getByLabel("Start").fill("10:00");
    await f.getByLabel("End").fill("11:00");
    await f.getByRole("button", { name: "Save slot" }).click();
    await expect(f).toBeHidden();
    await expect(page.getByRole("button", { name: /^Class, no subject, Lecture, 10:00 to 11:00, every week$/ })).toBeVisible();

    await page.getByRole("button", { name: "Next week" }).click();
    await expect(page.locator("section.tt-day").first()).toHaveAttribute("aria-label", "Sunday 28 March");
    await expect(page.locator("section.tt-day").nth(1).getByRole("button", { name: /Lecture, 10:00 to 11:00/ })).toBeVisible();

    // A slot in the hour that doesn't exist (01:30 on the Sunday) moves forward, it isn't lost.
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await f.getByLabel("Title").fill("Night owl");
    await f.getByLabel("Day").fill("2027-03-28");
    await f.getByLabel("Start").fill("01:30");
    await f.getByLabel("End").fill("02:30");
    await f.getByText("Just once", { exact: true }).click();
    await f.getByRole("button", { name: "Save slot" }).click();
    await expect(f).toBeHidden();
    await expect(page.locator("section.tt-day").first().getByRole("button", { name: /Night owl, 2:30 to 2:30|Night owl, 2:30 to/ })).toBeVisible();

    await page.getByRole("button", { name: "Add to my calendar" }).click();
    await page.getByRole("button", { name: "Make my calendar link" }).click();
    const url = await page.getByTestId("calendar-url").inputValue();
    const feed = await (await page.request.get(new URL(url).pathname)).text();
    expect(feed).toContain("DTSTART;TZID=Europe/London:20270322T100000");
    expect(feed).toContain("BEGIN:VTIMEZONE\r\nTZID:Europe/London");
    expect(feed).toContain("TZOFFSETTO:+0100");
  });
});

/** An Outlook desktop export: Windows zone ids, a quoted TZID, LANGUAGE parameters, an alarm. */
function outlookExport(first: string) {
  return [
    "BEGIN:VCALENDAR", "PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN", "VERSION:2.0", "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE", "TZID:GMT Standard Time",
    "BEGIN:STANDARD", "DTSTART:16011028T020000", "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10", "TZOFFSETFROM:+0100", "TZOFFSETTO:-0000", "END:STANDARD",
    "BEGIN:DAYLIGHT", "DTSTART:16010325T010000", "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3", "TZOFFSETFROM:-0000", "TZOFFSETTO:+0100", "END:DAYLIGHT",
    "END:VTIMEZONE",
    "BEGIN:VEVENT", "CLASS:PUBLIC", "DESCRIPTION:\\n",
    `DTSTART;TZID="GMT Standard Time":${ics(first)}T100000`, `DTEND;TZID="GMT Standard Time":${ics(first)}T110000`,
    "LOCATION:Room 2.14\\, Main Building", "RRULE:FREQ=WEEKLY;COUNT=4;INTERVAL=1;BYDAY=MO;WKST=SU",
    `EXDATE;TZID="GMT Standard Time":${ics(plus(first, 7))}T100000`,
    "SUMMARY;LANGUAGE=en-gb:BIOL1001 Lecture with a long name that has to wrap on a phone", "UID:040000008200E00074C5B7101A82E00800000000",
    "BEGIN:VALARM", "TRIGGER:-PT15M", "ACTION:DISPLAY", "DESCRIPTION:Reminder", "END:VALARM", "END:VEVENT",
    "BEGIN:VEVENT", `DTSTART;TZID=W. Europe Standard Time:${ics(plus(first, 2))}T140000`, `DTEND;TZID=W. Europe Standard Time:${ics(plus(first, 2))}T153000`,
    "RRULE:FREQ=WEEKLY;COUNT=3", "SUMMARY:Seminar (Berlin exchange)", "LOCATION:Online", "UID:abc-2", "END:VEVENT",
    "END:VCALENDAR", "",
  ].join("\r\n");
}

test.describe("Outlook export, student in Singapore, phone", () => {
  test.use({ timezoneId: "Asia/Singapore", viewport: { width: 375, height: 740 }, hasTouch: true, isMobile: true });

  test("imports in the student's zone; the preview fits 375 px", async ({ page }) => {
    await startDemo(page);
    const first = monday(2);
    await openTimetable(page, first);
    await page.getByRole("button", { name: "Import timetable" }).first().click();
    const dlg = page.getByRole("dialog", { name: "Import your timetable" });
    await dlg.getByTestId("import-file").setInputFiles({ name: "Calendar.ics", mimeType: "text/calendar", buffer: Buffer.from(outlookExport(first)) });
    await expect(dlg.getByTestId("import-summary")).toContainText("We found 6 classes in 2 groups");
    await expect(dlg.getByText("These times are in Europe/London. They're shown in your time zone (Asia/Singapore).")).toBeVisible();
    await expect(dlg.getByRole("table", { name: "Classes found in your file" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    const dlgBox = (await dlg.boundingBox())!;
    for (const el of await dlg.locator("table, select, button").all()) {
      const b = await el.boundingBox();
      if (b) expect(b.x + b.width, (await el.textContent()) ?? "").toBeLessThanOrEqual(dlgBox.x + dlgBox.width + 0.5);
    }
    // The 24 px boxes sit in a 44 px label that ticks them (same pattern as the settings switches).
    expect((await smallTargets(page)).filter((t) => !t.startsWith('input "Include '))).toEqual([]);
    for (const tick of await dlg.getByTestId("import-tick").all()) {
      const b = (await tick.boundingBox())!;
      expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
    }
    const seminar = dlg.getByRole("checkbox", { name: "Include Seminar (Berlin exchange)" });
    const tickBox = (await dlg.getByTestId("import-tick").nth(1).boundingBox())!;
    await page.touchscreen.tap(tickBox.x + 4, tickBox.y + 4); // the corner of the cell, not the box
    await expect(seminar).not.toBeChecked();
    await expect(dlg.getByRole("button", { name: "Add 3 classes" })).toBeVisible();
    await seminar.check();
    await expectNoA11yViolations(page);
    await dlg.getByRole("button", { name: "Add 6 classes" }).click();
    await expect(dlg).toBeHidden();
    // 10:00 London in winter is 18:00 in Singapore (or 17:00 while London is on summer time).
    await expect(page.getByRole("button", { name: /^Class, no subject, BIOL1001 Lecture.*, 1[78]:00 to 1[89]:00, Room 2\.14, Main Building/ }).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

test.describe("focus view on a phone, dark mode", () => {
  test.use({ viewport: { width: 375, height: 740 }, hasTouch: true, isMobile: true, colorScheme: "dark" });

  test("/timer fits 375 px with 44 px targets and passes axe while running", async ({ page }) => {
    await startDemo(page);
    await page.goto("/timer");
    await expect(page.getByRole("heading", { name: "Study timer", level: 1 })).toBeVisible();
    await expectNoHorizontalScroll(page);
    expect(await smallTargets(page)).toEqual([]);
    await expectNoA11yViolations(page);
    await page.getByRole("button", { name: "Start focus" }).click();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    expect(await smallTargets(page)).toEqual([]);
    await expectNoA11yViolations(page);
    await page.getByRole("button", { name: "Stop" }).click();
    await expect(page.getByText("End this round? It's under a minute, so it won't be saved.")).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
