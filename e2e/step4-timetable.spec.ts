import { expect, test, type Page } from "@playwright/test";
import { createSubject, expectNoA11yViolations, expectNoHorizontalScroll, openSettings, smallTargets, startDemo } from "./helpers";

// Step 4 part 2: the timetable, the .ics import and the calendar link
// (docs/design/screens/timetable.md). Everything runs in UTC so the dates below are the dates the
// app shows. Slots go into weeks after this one, so the tests don't depend on the time of day.

test.use({ timezoneId: "UTC" });

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Monday of the week `weeks` from now (UTC). */
function monday(weeks: number): string {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const back = (new Date(today).getUTCDay() + 6) % 7;
  return iso(today - back * DAY + weeks * 7 * DAY);
}
const plus = (date: string, days: number) => iso(Date.parse(`${date}T00:00:00Z`) + days * DAY);
const ics = (date: string) => date.replaceAll("-", "");

const slots = (page: Page) => page.getByTestId("slot");
const slotNamed = (page: Page, name: RegExp | string) => page.getByRole("button", { name });
const form = (page: Page, title = "New slot") => page.getByRole("dialog", { name: title });

async function openTimetable(page: Page, week?: string) {
  await page.goto(week ? `/timetable?week=${week}` : "/timetable");
  await expect(page.getByRole("heading", { name: "Timetable", level: 1 })).toBeVisible();
  await expect(page.getByTestId("week-grid")).toBeVisible();
}

async function fillSlot(page: Page, o: { kind?: "Class" | "Study" | "Other"; subject?: string; title?: string; date?: string; start: string; end: string; once?: boolean; location?: string }, title = "New slot") {
  const f = form(page, title);
  await expect(f).toBeVisible();
  if (o.kind) await f.getByText(o.kind, { exact: true }).click();
  if (o.subject) await f.getByLabel("Subject").selectOption({ label: o.subject });
  if (o.title !== undefined) await f.getByLabel("Title").fill(o.title);
  if (o.date) await f.getByLabel("Day").fill(o.date);
  await f.getByLabel("Start").fill(o.start);
  await f.getByLabel("End").fill(o.end);
  if (o.once) await f.getByText("Just once", { exact: true }).click();
  if (o.location !== undefined) await f.getByLabel("Location").fill(o.location);
  await f.getByRole("button", { name: "Save slot" }).click();
  await expect(f).toBeHidden();
}

async function addSlot(page: Page, o: Parameters<typeof fillSlot>[1]) {
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await fillSlot(page, o);
}

/** Phones show one day: pick it in the day strip (index from the start of the week). */
async function showDay(page: Page, isMobile: boolean, index: number) {
  if (!isMobile) return;
  await page.getByRole("radiogroup", { name: "Day" }).getByRole("radio").nth(index).check({ force: true });
}

async function openDetails(page: Page, name: RegExp | string) {
  await slotNamed(page, name).click();
  const d = page.getByTestId("slot-details");
  await expect(d).toBeVisible();
  return d;
}

test("add a slot with the Add form, see it, open its details", async ({ page }) => {
  await startDemo(page);
  const week = monday(1);
  await openTimetable(page, week);
  await expect(page.getByTestId("timetable-empty")).toBeVisible();
  await expectNoA11yViolations(page);

  await addSlot(page, { title: "BIOL1001 Lecture", date: week, start: "10:00", end: "11:30", location: "Room 2.14" });
  await expect(page.getByTestId("timetable-empty")).toBeHidden();
  await expect(slotNamed(page, "Class, no subject, BIOL1001 Lecture, 10:00 to 11:30, Room 2.14, every week")).toBeVisible();

  const d = await openDetails(page, /BIOL1001 Lecture/);
  await expect(d.getByRole("heading", { name: "BIOL1001 Lecture" })).toBeVisible();
  await expect(d.getByText(/10:00–11:30/)).toBeVisible();
  await expect(d.getByText(/^Every Monday$/)).toBeVisible();
  await expectNoA11yViolations(page);
  await page.keyboard.press("Escape");
  await expect(d).toBeHidden();

  // The same class next week (weekly), not the week before.
  await page.getByRole("button", { name: "Next week" }).click();
  await expect(slotNamed(page, /BIOL1001 Lecture/)).toBeVisible();
  await page.getByRole("button", { name: "Previous week" }).click();
  await page.getByRole("button", { name: "Previous week" }).click();
  await expect(slotNamed(page, /BIOL1001 Lecture/)).toHaveCount(0);
  await expect(page.getByTestId("nothing-this-week")).toContainText("Nothing this week");
  await page.getByTestId("nothing-this-week").getByRole("button", { name: /Next class/ }).click();
  await expect(slotNamed(page, /BIOL1001 Lecture/)).toBeVisible();
});

test("form errors: end before start, over 12 hours", async ({ page }) => {
  await startDemo(page);
  await openTimetable(page, monday(1));
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const f = form(page);
  await f.getByLabel("Start").fill("11:00");
  await f.getByLabel("End").fill("10:00");
  await f.getByRole("button", { name: "Save slot" }).click();
  await expect(f.getByRole("alert")).toHaveText("End has to be after the start.");
  await f.getByLabel("Start").fill("06:00");
  await f.getByLabel("End").fill("19:00");
  await f.getByRole("button", { name: "Save slot" }).click();
  await expect(f.getByRole("alert")).toHaveText("A slot can be up to 12 hours.");
  await f.getByLabel("End").fill("07:30");
  await expect(f.getByTestId("slot-length")).toHaveText("1 h 30 min");
  await f.getByRole("button", { name: "Cancel" }).click();
  await expect(f).toBeHidden();
});

test("drag to create, then drag to move a weekly slot (pointer)", async ({ page, isMobile }) => {
  test.skip(isMobile, "Drag is for mouse and pen; touch taps (see the phone test).");
  await startDemo(page);
  const week = monday(1);
  await openTimetable(page, week);
  const layer = page.getByTestId("drag-layer-0");
  const box = (await layer.boundingBox())!;
  const hourPx = 48;
  const y = (min: number) => box.y + (min / 60) * hourPx;
  // 10:05 down to 11:20: a ghost in 15-minute steps, 10:00–11:30.
  await page.mouse.move(box.x + 30, y(605));
  await page.mouse.down();
  await page.mouse.move(box.x + 30, y(650), { steps: 4 });
  await page.mouse.move(box.x + 30, y(680), { steps: 4 });
  await expect(page.getByTestId("drag-ghost")).toHaveText("10:00–11:30");
  await page.mouse.up();
  const f = form(page);
  await expect(f.getByLabel("Start")).toHaveValue("10:00");
  await expect(f.getByLabel("End")).toHaveValue("11:30");
  await expect(f.getByLabel("Day")).toHaveValue(week);
  await fillSlot(page, { title: "Lab", start: "10:00", end: "11:30" });
  const lab = slotNamed(page, /Lab, 10:00 to 11:30/);
  await expect(lab).toBeVisible();

  // Esc during a drag cancels it.
  const s = (await lab.boundingBox())!;
  await page.mouse.move(s.x + 20, s.y + 20);
  await page.mouse.down();
  await page.mouse.move(s.x + 20, s.y + 80, { steps: 5 });
  await expect(page.getByTestId("drag-ghost")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("drag-ghost")).toHaveCount(0);
  await page.mouse.up();
  await expect(slotNamed(page, /Lab, 10:00 to 11:30/)).toBeVisible();
  await expect(page.getByTestId("slot-details")).toBeHidden();

  // Move it one hour later: a weekly slot asks which weeks.
  await page.mouse.move(s.x + 20, s.y + 20);
  await page.mouse.down();
  await page.mouse.move(s.x + 20, s.y + 20 + hourPx, { steps: 6 });
  await expect(page.getByTestId("drag-ghost")).toHaveText("11:00–12:30");
  await page.mouse.up();
  const ask = page.getByTestId("scope-ask");
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Every week" }).click();
  await expect(slotNamed(page, /Lab, 11:00 to 12:30, every week/)).toBeVisible();
  await expect(page.getByTestId("tt-announce")).toHaveText("Lab moved to Monday, 11:00 to 12:30.");

  // Resize its end by half an hour, just this week.
  const r = (await slotNamed(page, /Lab, 11:00/).getByTestId("slot-resize").boundingBox())!;
  await page.mouse.move(r.x + 20, r.y + r.height / 2);
  await page.mouse.down();
  await page.mouse.move(r.x + 20, r.y + r.height / 2 + hourPx / 2, { steps: 5 });
  await page.mouse.up();
  await page.getByTestId("scope-ask").getByRole("button", { name: "Just this week" }).click();
  await expect(slotNamed(page, /Lab, 11:00 to 13:00, just once/)).toBeVisible();
  await page.getByRole("button", { name: "Next week" }).click();
  await expect(slotNamed(page, /Lab, 11:00 to 12:30, every week/)).toBeVisible();
});

test("edit just this week and every week", async ({ page }) => {
  await startDemo(page);
  const a = monday(1);
  await openTimetable(page, a);
  await addSlot(page, { title: "Tutorial", date: a, start: "10:00", end: "11:00" });

  // Week 2: just this week moves to 14:00.
  await page.getByRole("button", { name: "Next week" }).click();
  let d = await openDetails(page, /Tutorial/);
  await d.getByRole("button", { name: "Edit" }).click();
  let f = form(page, "Edit slot");
  await expect(f.getByRole("radio", { name: "Just this week" })).toBeChecked();
  await expect(f.getByText("Repeats")).toHaveCount(0);
  await fillSlot(page, { start: "14:00", end: "15:00" }, "Edit slot");
  await expect(slotNamed(page, /Tutorial, 14:00 to 15:00, just once/)).toBeVisible();
  await expect(slotNamed(page, /Tutorial, 10:00/)).toHaveCount(0);

  // Week 3: every week from here moves to 12:00.
  await page.getByRole("button", { name: "Next week" }).click();
  d = await openDetails(page, /Tutorial, 10:00/);
  await d.getByRole("button", { name: "Edit" }).click();
  f = form(page, "Edit slot");
  await f.getByText("Every week", { exact: true }).first().click();
  await fillSlot(page, { start: "12:00", end: "13:00" }, "Edit slot");
  await expect(slotNamed(page, /Tutorial, 12:00 to 13:00, every week/)).toBeVisible();
  await page.getByRole("button", { name: "Next week" }).click();
  await expect(slotNamed(page, /Tutorial, 12:00 to 13:00, every week/)).toBeVisible();
  // Earlier weeks keep the old times.
  await page.getByRole("button", { name: "This week" }).click();
  await page.getByRole("button", { name: "Next week" }).click();
  await expect(slotNamed(page, /Tutorial, 10:00 to 11:00, every week/)).toBeVisible();
});

test("delete with undo", async ({ page, isMobile }) => {
  await startDemo(page);
  const a = monday(1);
  await openTimetable(page, a);
  await addSlot(page, { kind: "Other", title: "Shift", date: a, start: "17:00", end: "19:00" });
  await addSlot(page, { kind: "Study", date: plus(a, 2), start: "09:00", end: "10:00", once: true });

  // A weekly slot: just this week, then Undo. (Saving jumped phones to the study block's day.)
  await showDay(page, isMobile, 0);
  let d = await openDetails(page, /Shift/);
  await d.getByRole("button", { name: "Delete" }).click();
  await d.getByRole("button", { name: "Just this week" }).click();
  await expect(slotNamed(page, /Shift/)).toHaveCount(0);
  const toast = page.getByTestId("toast");
  await expect(toast).toContainText("Deleted Shift.");
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(slotNamed(page, /Shift/)).toBeVisible();

  // A one-off slot goes straight away (Undo is the safety net).
  await showDay(page, isMobile, 2);
  d = await openDetails(page, /^Study, no subject, Study, 9:00 to 10:00, just once$/);
  await d.getByRole("button", { name: "Delete" }).click();
  await expect(slotNamed(page, /^Study, no subject/)).toHaveCount(0);
  await page.getByTestId("toast").getByRole("button", { name: "Undo" }).click();
  await expect(slotNamed(page, /^Study, no subject/)).toBeVisible();

  // From the form: every week from week 2 on.
  await page.getByRole("button", { name: "Next week" }).click();
  await showDay(page, isMobile, 0);
  d = await openDetails(page, /Shift/);
  await d.getByRole("button", { name: "Edit" }).click();
  const f = form(page, "Edit slot");
  await f.getByRole("button", { name: "Delete slot" }).click();
  await f.getByRole("button", { name: "Every week" }).last().click();
  await expect(f).toBeHidden();
  await expect(slotNamed(page, /Shift/)).toHaveCount(0);
  await page.getByRole("button", { name: "Previous week" }).click();
  await expect(slotNamed(page, /Shift/)).toBeVisible();
});

function timetableFile(first: string, bioStart = "100000", bioEnd = "110000") {
  const wed = plus(first, 2);
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Uni//Timetable//EN",
    "BEGIN:VEVENT", "UID:bio-lecture@uni", `DTSTART:${ics(first)}T${bioStart}Z`, `DTEND:${ics(first)}T${bioEnd}Z`,
    "RRULE:FREQ=WEEKLY;COUNT=6", "SUMMARY:Biology Lecture", "LOCATION:Room 2.14", "END:VEVENT",
    "BEGIN:VEVENT", "UID:chem-tut@uni", `DTSTART:${ics(wed)}T140000Z`, `DTEND:${ics(wed)}T150000Z`,
    "RRULE:FREQ=WEEKLY;COUNT=6", "SUMMARY:CHEM1002 Tutorial", "LOCATION:Lab 4", "END:VEVENT",
    "BEGIN:VEVENT", "UID:open-day@uni", `DTSTART;VALUE=DATE:${ics(first)}`, "SUMMARY:Open day", "END:VEVENT",
    "END:VCALENDAR", "",
  ].join("\r\n");
}

async function importFile(page: Page, text: string) {
  await page.getByRole("button", { name: "Import timetable" }).first().click();
  const dlg = page.getByRole("dialog", { name: "Import your timetable" });
  await expect(dlg).toBeVisible();
  await dlg.getByTestId("import-file").setInputFiles({ name: "timetable.ics", mimeType: "text/calendar", buffer: Buffer.from(text) });
  await expect(dlg.getByTestId("import-summary")).toBeVisible();
  return dlg;
}

test("import with preview and undo, then re-import", async ({ page, isMobile }) => {
  await startDemo(page);
  await createSubject(page, "Biology");
  const first = monday(1);
  await openTimetable(page);

  // Not a calendar file.
  await page.getByRole("button", { name: "Import timetable" }).first().click();
  let dlg = page.getByRole("dialog", { name: "Import your timetable" });
  await dlg.getByTestId("import-file").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(dlg.getByRole("alert")).toHaveText("That isn't a calendar file. Look for a file ending in .ics.");
  await dlg.getByTestId("import-file").setInputFiles({ name: "empty.ics", mimeType: "text/calendar", buffer: Buffer.from("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n") });
  await expect(dlg.getByRole("alert")).toHaveText("We couldn't find any classes in that file.");
  await dlg.getByRole("button", { name: "Cancel" }).click();

  dlg = await importFile(page, timetableFile(first));
  await expect(dlg.getByTestId("import-summary")).toContainText("We found 12 classes in 2 groups");
  await expect(dlg.getByTestId("import-left-out")).toContainText("1 all-day event");
  await expect(dlg.getByRole("table", { name: "Classes found in your file" })).toBeVisible();
  await expect(dlg.getByRole("checkbox", { name: "Include Biology Lecture" })).toBeChecked();
  await expect(dlg.getByRole("combobox", { name: "Subject for Biology Lecture" })).toHaveValue(/[0-9a-f-]{36}/);
  await expect(dlg.getByRole("combobox", { name: "Subject for CHEM1002 Tutorial" })).toHaveValue("");
  if (!isMobile) await expect(dlg.getByTestId("mini-week")).toBeVisible();
  await expectNoA11yViolations(page);
  await dlg.getByRole("checkbox", { name: "Include CHEM1002 Tutorial" }).uncheck();
  await expect(dlg.getByRole("button", { name: "Add 6 classes" })).toBeVisible();
  await dlg.getByRole("checkbox", { name: "Include CHEM1002 Tutorial" }).check();
  await dlg.getByRole("button", { name: "Add 12 classes" }).click();
  await expect(dlg).toBeHidden();
  const toast = page.getByTestId("toast");
  await expect(toast).toContainText("Added 12 classes to your timetable.");
  await expect(slotNamed(page, /^Class, Biology, Biology Lecture, 10:00 to 11:00, Room 2.14, every week$/)).toBeVisible();
  await showDay(page, isMobile, 2);
  await expect(slotNamed(page, /CHEM1002 Tutorial/)).toBeVisible();

  // Undo removes the whole import.
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(slots(page)).toHaveCount(0);

  // Again, then re-import a changed file: Biology moved to 11:00 (new), Tutorial kept (updated),
  // the 10:00 lecture is gone (removed). A slot made by hand is never touched.
  dlg = await importFile(page, timetableFile(first));
  await dlg.getByRole("button", { name: "Add 12 classes" }).click();
  await expect(dlg).toBeHidden();
  await addSlot(page, { title: "Gym", date: first, start: "18:00", end: "19:00" });
  dlg = await importFile(page, timetableFile(first, "110000", "120000"));
  await expect(dlg.getByRole("checkbox", { name: "Replace my previous import" })).toBeChecked();
  await expect(dlg.getByTestId("import-changes")).toHaveText("1 updated, 1 new, 1 removed");
  await dlg.getByRole("button", { name: "Add 12 classes" }).click();
  await expect(dlg).toBeHidden();
  await showDay(page, isMobile, 0);
  await expect(slotNamed(page, /Biology Lecture, 11:00 to 12:00/)).toBeVisible();
  await expect(slotNamed(page, /Biology Lecture, 10:00/)).toHaveCount(0);
  await expect(slotNamed(page, /Gym/)).toBeVisible();
  await showDay(page, isMobile, 2);
  await expect(slotNamed(page, /CHEM1002 Tutorial/)).toBeVisible();
  await showDay(page, isMobile, 0);
  // The re-import's Undo puts the previous import back.
  await page.getByTestId("toast").getByRole("button", { name: "Undo" }).click();
  await expect(slotNamed(page, /Biology Lecture, 10:00 to 11:00/)).toBeVisible();
  await expect(slotNamed(page, /Biology Lecture, 11:00/)).toHaveCount(0);
});

test("calendar link: make, copy, feed, reset, turn off", async ({ page, context, browserName }) => {
  if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await startDemo(page);
  const a = monday(1);
  await openTimetable(page, a);
  await addSlot(page, { title: "Lab", date: a, start: "10:00", end: "11:00", location: "Room 1; B" });

  await page.getByRole("button", { name: "Add to my calendar" }).click();
  const panel = page.getByRole("dialog", { name: "Your calendar link" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "Make my calendar link" })).toBeVisible();
  await panel.getByRole("button", { name: "Make my calendar link" }).click();
  const url = panel.getByLabel("Calendar link");
  await expect(url).toHaveValue(/\/api\/calendar\/[A-Za-z0-9_-]{43}\.ics$/);
  const first = await url.inputValue();
  await expect(panel.getByTestId("calendar-status")).toContainText("Not checked by a calendar yet");
  await expectNoA11yViolations(page);

  await panel.getByRole("button", { name: "Copy link" }).click();
  await expect(panel.getByRole("button", { name: /Copied!/ })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(first);

  // Tabs: arrow keys move between them.
  await panel.getByRole("tab", { name: "Google" }).click();
  await page.keyboard.press("ArrowRight");
  await expect(panel.getByRole("tab", { name: "Apple" })).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByRole("link", { name: "Open in Apple Calendar" })).toHaveAttribute("href", first.replace(/^https?:\/\//, "webcal://"));

  // The feed: valid calendar file, private caching, the slot as a weekly event.
  const feed = await page.request.get(first);
  expect(feed.status()).toBe(200);
  expect(feed.headers()["content-type"]).toContain("text/calendar");
  expect(feed.headers()["cache-control"]).toContain("no-store");
  const body = await feed.text();
  expect(body.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
  expect(body).toContain("SUMMARY:Lab\r\n");
  expect(body).toContain("LOCATION:Room 1\\; B\r\n");
  expect(body).toContain("RRULE:FREQ=WEEKLY");
  expect(body.trimEnd().endsWith("END:VCALENDAR")).toBe(true);

  // Shown again when the panel is opened again, now checked by a calendar.
  await panel.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Add to my calendar" }).click();
  await expect(panel.getByLabel("Calendar link")).toHaveValue(first);
  await expect(panel.getByTestId("calendar-status")).toContainText("Last checked by your calendar just now");

  // Reset: a new link, the old one is 404.
  await panel.getByRole("button", { name: "Reset link" }).click();
  await expect(panel.getByText(/The old link stops working straight away/)).toBeVisible();
  await panel.getByRole("button", { name: "Reset link" }).click();
  await expect(panel.getByTestId("toast")).toContainText("New link made. The old one no longer works.");
  await expect(panel.getByLabel("Calendar link")).not.toHaveValue(first);
  const second = await panel.getByLabel("Calendar link").inputValue();
  expect((await page.request.get(first)).status()).toBe(404);
  expect((await page.request.get(second)).status()).toBe(200);

  // Turn off: back to "Make my calendar link", the link is 404.
  await panel.getByRole("button", { name: "Turn off link" }).click();
  await panel.getByRole("button", { name: "Turn off link" }).click();
  await expect(panel.getByRole("button", { name: "Make my calendar link" })).toBeVisible();
  expect((await page.request.get(second)).status()).toBe(404);
  expect((await page.request.get("/api/calendar/not-a-token.ics")).status()).toBe(404);

  // The export has the slot and never the link.
  const exported = await (await page.request.get("/api/export")).text();
  expect(exported).toContain("\"timetableSlots\"");
  expect(exported).not.toContain(second.split("/").pop()!.replace(".ics", ""));
});

test("subject page study strip: Add a class, then Next", async ({ page }) => {
  await startDemo(page);
  await createSubject(page, "Biology");
  await page.getByRole("link", { name: /Biology/ }).first().click();
  const strip = page.getByTestId("study-strip");
  await strip.getByRole("link", { name: "Add a class" }).click();
  await expect(page).toHaveURL(/\/timetable/);
  const f = form(page);
  await expect(f.getByLabel("Subject")).toHaveValue(/[0-9a-f-]{36}/);
  await expect(f.getByRole("radio", { name: "Class" })).toBeChecked();
  const date = plus(monday(1), 1);
  await fillSlot(page, { title: "BIOL1001 Lecture", date, start: "10:00", end: "11:00", location: "Room 2.14" });
  await page.goBack();
  await page.reload();
  const next = page.getByTestId("study-strip").getByRole("link", { name: /^Next class: BIOL1001 Lecture, .+ 10:00, Room 2\.14$/ });
  await expect(next).toBeVisible();
  await expect(next).toContainText("Next: BIOL1001 Lecture");
  await next.click();
  await expect(page).toHaveURL(new RegExp(`/timetable\\?week=${date}`));
  await expect(slotNamed(page, /BIOL1001 Lecture/)).toBeVisible();
  // The address keeps the class's day after the screen has loaded, so a reload (on a phone: the
  // day strip) lands on it too. It used to be rewritten to the Monday (a flaky URL check here).
  await page.reload();
  await expect(slotNamed(page, /BIOL1001 Lecture/)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/timetable\\?week=${date}$`));
});

test("keyboard: N adds, T goes back, arrows change week, Enter opens a slot", async ({ page, isMobile }) => {
  test.skip(isMobile, "Keyboard shortcuts are tested on desktop.");
  await startDemo(page);
  await openTimetable(page);
  const label = page.getByTestId("week-label");
  const thisWeek = await label.textContent();
  await page.locator("body").press("n");
  await expect(form(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(form(page)).toBeHidden();

  await page.getByRole("button", { name: "Next week" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(label).toHaveText("This week");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(label).toHaveText("This week");
  await page.locator("body").press("t");
  await expect(label).toHaveText(thisWeek!);

  // Add by keyboard only, then reach the slot with Tab and open it with Enter.
  await page.getByRole("button", { name: "Add", exact: true }).focus();
  await page.keyboard.press("Enter");
  const f = form(page);
  await f.getByLabel("Title").fill("Seminar");
  await f.getByLabel("Day").fill(plus(monday(0), 3));
  await f.getByLabel("Start").fill("13:00");
  await f.getByLabel("End").fill("14:00");
  await f.getByLabel("Location").press("Enter");
  await expect(f).toBeHidden();
  const seminar = slotNamed(page, /Seminar/);
  await seminar.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("slot-details")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("slot-details")).toBeHidden();
  await expect(seminar).toBeFocused();
});

test("phone at 375 px: day strip, tap to create, no sideways scroll", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone layout.");
  await page.setViewportSize({ width: 375, height: 760 });
  await startDemo(page);
  const a = monday(1);
  await openTimetable(page, a);
  await expect(page.getByRole("link", { name: "Timetable" })).toHaveAttribute("aria-current", "page");
  const strip = page.getByRole("radiogroup", { name: "Day" });
  await expect(strip.getByRole("radio")).toHaveCount(7);
  await expect(strip.getByRole("radio").first()).toBeChecked();
  await expectNoHorizontalScroll(page);
  expect(await smallTargets(page)).toEqual([]);

  // Tap an hour on Wednesday.
  await strip.getByRole("radio").nth(2).check({ force: true });
  await expect(page.getByRole("region", { name: new RegExp(`^Wednesday`) })).toBeVisible();
  const layer = page.getByTestId("drag-layer-0");
  // The grid sits low on a phone: put 10:00 at the top of the grid and the grid on screen,
  // otherwise the tap can land below the viewport (it did on CI) or on the empty-week sticker.
  await page.locator(".tt-scroll").evaluate((el) => { el.scrollTop = 9.75 * 48; el.scrollIntoView({ block: "nearest" }); });
  const box = (await layer.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + 10.2 * 48);
  const f = form(page);
  await expect(f).toBeVisible();
  await expect(f.getByLabel("Start")).toHaveValue("10:00");
  await expect(f.getByLabel("End")).toHaveValue("11:00");
  await expect(f.getByLabel("Day")).toHaveValue(plus(a, 2));
  await fillSlot(page, { kind: "Study", start: "10:00", end: "11:00" });
  await expect(slotNamed(page, /^Study, no subject, Study, 10:00 to 11:00, every week$/)).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectNoA11yViolations(page);

  const d = await openDetails(page, /^Study, no subject/);
  await expect(d.getByRole("button", { name: "Edit" })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("settings: week starts on Sunday, calendar link inline", async ({ page, isMobile }) => {
  await startDemo(page);
  await openSettings(page);
  const section = page.getByRole("region", { name: "Timetable and calendar" });
  await expect(section.getByText(/Times are shown in UTC/)).toBeVisible();
  await section.getByText("Sunday", { exact: true }).click();
  await expect(page.getByText("Saved")).toBeVisible();
  await section.getByRole("button", { name: "Make my calendar link" }).click();
  await expect(section.getByLabel("Calendar link")).toHaveValue(/\.ics$/);
  await expectNoA11yViolations(page);

  await openTimetable(page);
  if (isMobile) await expect(page.getByRole("radiogroup", { name: "Day" }).getByRole("radio").first()).toHaveAccessibleName(/^Sunday/);
  else await expect(page.locator("section.tt-day").first()).toHaveAttribute("aria-label", /Sunday/);
});
