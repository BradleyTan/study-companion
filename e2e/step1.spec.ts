import path from "node:path";
import { expect, test } from "@playwright/test";
import { createSubject, expectNoA11yViolations, expectNoHorizontalScroll, startDemo } from "./helpers";

const fixture = (name: string) => path.join(__dirname, "fixtures", name);

test("signed-out visitors are sent to sign in", async ({ page }) => {
  await page.goto("/subjects");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Open your notebook" })).toBeVisible();
});

test("landing and privacy pages are public and accessible", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your whole course, one notebook." })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole("link", { name: "How we handle your notes" }).click();
  await expect(page.getByRole("heading", { name: "How we look after your notes" })).toBeVisible();
  await expect(page.getByText(/don&apos;t use your notes for training|don.t use your notes for training/)).toBeVisible();
  await expectNoA11yViolations(page);
});

test("create, edit and delete a subject", async ({ page }) => {
  await startDemo(page);
  await expect(page.getByText("Your notebook is empty")).toBeVisible();
  await expectNoA11yViolations(page);
  await createSubject(page, "Biology 101", { emoji: "🧪" });
  await expectNoHorizontalScroll(page);

  await page.getByRole("link", { name: /Biology 101/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Biology 101" })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: "Edit subject" });
  await edit.getByLabel("Name").fill("Cell Biology");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Cell Biology" })).toBeVisible();

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Delete Cell Biology?" });
  await expect(confirm).toContainText("0 notes and 0 files");
  await confirm.getByRole("button", { name: "Delete subject" }).click();
  await expect(page).toHaveURL(/\/subjects$/);
  await expect(page.getByText("Your notebook is empty")).toBeVisible();
});

test("a blank subject name is rejected with a helpful message", async ({ page }) => {
  await startDemo(page);
  await page.getByRole("button", { name: "Create your first subject" }).click();
  const dialog = page.getByRole("dialog", { name: "New subject" });
  await dialog.getByRole("button", { name: "Create subject" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Give your subject a name.");
});

test("notes autosave and survive a reload", async ({ page }) => {
  await startDemo(page);
  await createSubject(page, "Chemistry");
  await page.getByRole("link", { name: /Chemistry/ }).click();
  await page.getByRole("button", { name: "+ Write a note" }).click();
  await expect(page).toHaveURL(/\/notes\//);

  await page.getByLabel("Title").fill("Acids and bases");
  const body = page.getByRole("textbox", { name: "Note text" });
  await body.click();
  await page.keyboard.type("pH below 7 is acidic.");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Bold" }).click();
  await page.keyboard.type("Neutral is 7.");
  await expect(page.getByTestId("save-state")).toHaveText("Saved ✓", { timeout: 10_000 });
  await expectNoA11yViolations(page);
  await expectNoHorizontalScroll(page);

  await page.reload();
  await expect(page.getByLabel("Title")).toHaveValue("Acids and bases");
  await expect(page.getByRole("textbox", { name: "Note text" })).toContainText("pH below 7 is acidic.");
  await expect(page.locator(".tiptap strong")).toHaveText("Neutral is 7.");

  await page.getByRole("link", { name: "← Back to Chemistry" }).click();
  await expect(page.getByRole("link", { name: /Acids and bases/ })).toBeVisible();
});

test("uploads: PDF text is read, fakes are rejected, scans are flagged", async ({ page }) => {
  await startDemo(page);
  await createSubject(page, "Physiology");
  await page.getByRole("link", { name: /Physiology/ }).click();

  const input = page.locator("#file-input");
  await input.setInputFiles(fixture("lecture.pdf"));
  await expect(page.getByText("Ready · 3 pages")).toBeVisible({ timeout: 15_000 });

  await input.setInputFiles(fixture("fake.pdf"));
  await expect(page.getByRole("alert").filter({ hasText: "isn't really a PDF" })).toBeVisible({ timeout: 15_000 });

  await input.setInputFiles(fixture("scanned.pdf"));
  await expect(page.getByText("No text found (scanned?)")).toBeVisible({ timeout: 15_000 });

  await input.setInputFiles({ name: "notes.docx", mimeType: "application/msword", buffer: Buffer.from("hello") });
  await expect(page.getByRole("alert").filter({ hasText: "Only PDF and PPTX files" })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Delete one file
  await page.getByRole("button", { name: "Delete lecture.pdf" }).click();
  await page.getByRole("button", { name: "Delete file" }).click();
  await expect(page.getByText("Ready · 3 pages")).toBeHidden();
});

test("one student can't open another student's subject", async ({ browser }) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pa = await a.newPage();
  const pb = await b.newPage();
  await startDemo(pa);
  await createSubject(pa, "Secret Law Notes");
  await pa.getByRole("link", { name: /Secret Law Notes/ }).click();
  await pa.waitForURL(/\/subjects\/[0-9a-f-]{36}$/);
  const url = pa.url();

  await startDemo(pb);
  await pb.goto(url);
  // Streaming has already sent a 200 by the time the page decides; what matters is that nothing leaks.
  await expect(pb.getByText("This page fell out of the notebook")).toBeVisible();
  await expect(pb.getByText("Secret Law Notes")).toHaveCount(0);
  const exported = await (await pb.request.get("/api/export")).json();
  expect(JSON.stringify(exported)).not.toContain("Secret Law Notes");
  await a.close();
  await b.close();
});

test("settings: sound and theme are remembered, export downloads", async ({ page }) => {
  await startDemo(page);
  await page.getByRole("link", { name: "Settings" }).click();
  await expectNoA11yViolations(page);
  const sound = page.getByLabel("Play sounds");
  await expect(sound).toBeChecked();
  await sound.uncheck();
  await expect(page.getByText("Saved")).toBeVisible();
  await page.getByText("Dark", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expectNoA11yViolations(page);

  await page.reload();
  await expect(page.getByLabel("Play sounds")).not.toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  const res = await page.request.get("/api/export");
  expect(res.headers()["content-disposition"]).toContain("attachment");
  expect((await res.json()).profile).toMatchObject({ soundOn: false, theme: "dark" });
});

test("delete account removes everything", async ({ page }) => {
  await startDemo(page);
  await createSubject(page, "Temporary");
  await page.getByRole("link", { name: "Settings" }).click();
  const btn = page.getByRole("button", { name: "Delete my account" });
  await expect(btn).toBeDisabled();
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await btn.click();
  await expect(page.getByText("Your account and everything in it has been deleted.")).toBeVisible();
  await page.goto("/subjects");
  await expect(page).toHaveURL(/\/login$/);
});

test("a sign-in link that lands on the home page is passed on to the callback", async ({ request }) => {
  const res = await request.get("/?code=abc123", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  const to = new URL(res.headers()["location"], "http://localhost");
  expect(to.pathname).toBe("/auth/callback");
  expect(to.searchParams.get("code")).toBe("abc123");
  expect(to.searchParams.get("next")).toBe("/subjects");
});
