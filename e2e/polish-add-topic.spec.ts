import { expect, test, type Page } from "@playwright/test";
import { createSubject, expectNoA11yViolations, startDemo } from "./helpers";

// QA for "+ Add weak topic" (docs/design/polish.md "Added for the student test"): Practise on a
// hand-added topic, a quiz miss and its undo on the same card, and reopening from Got it.
// Demo mode: the local generator writes quizzes and names each question's topic.

const TITLE = "Cell structure";
const NOTE = [
  "The mitochondria is the organelle that makes energy for the cell through respiration.",
  "Ribosomes are small structures that build proteins from amino acids.",
  "The nucleus contains the genetic material of the cell and controls its activity.",
  "Photosynthesis means turning light energy into chemical energy inside chloroplasts.",
  "The cell membrane is a thin layer that controls what enters and leaves the cell.",
  "Osmosis is the movement of water across a partially permeable membrane.",
].join(" ");

async function subjectWithNote(page: Page, subject: string): Promise<string> {
  await startDemo(page);
  await createSubject(page, subject);
  await page.getByRole("link", { name: new RegExp(subject) }).click();
  await expect(page.getByRole("heading", { level: 1, name: subject })).toBeVisible();
  const subjectUrl = page.url();
  await page.getByRole("button", { name: "+ Write a note" }).first().click();
  await expect(page).toHaveURL(/\/notes\//);
  await page.getByLabel("Title").fill(TITLE);
  await page.getByRole("textbox", { name: "Note text" }).click();
  await page.keyboard.insertText(NOTE);
  await expect(page.getByTestId("save-state")).toHaveText("Saved ✓", { timeout: 10_000 });
  return subjectUrl;
}

async function addTopic(page: Page, name: string, toast: string) {
  await page.getByRole("button", { name: "+ Add weak topic" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a weak topic" });
  await dialog.getByLabel("Topic").fill(name);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("toast")).toContainText(toast);
}

const openList = (page: Page) => page.getByRole("list", { name: "Open weak topics" }).getByRole("article");

test("Practise on a hand-added topic that a note mentions makes a quiz and uses one go", async ({ page }) => {
  const subjectUrl = await subjectWithNote(page, "Biology");
  await page.goto(`${subjectUrl}/weak-topics`);
  await addTopic(page, "osmosis", "Added to your weak topics.");
  await page.getByRole("button", { name: "Practise osmosis" }).click();
  const make = page.locator("dialog[open]");
  await expect(make.getByText("added by you")).toBeVisible();
  await expect(make.getByTestId("quota-chip")).toHaveText("3 of 3 left today");
  await make.getByRole("button", { name: "Make quiz" }).click();
  await expect(make.getByRole("heading", { name: /^Quiz ready!/ })).toBeVisible({ timeout: 15_000 });
  await expect(make.getByText(/From your weak topics/)).toBeVisible();
  await page.reload();
  await expect(page.locator("#weak-quota")).toHaveText("2 of 3 left today");
});

test("keyboard: the sheet opens with focus in Topic, Escape cancels, and focus lands on '+ Add weak topic' after adding from the empty state", async ({ page }) => {
  await startDemo(page);
  await createSubject(page, "Physics");
  await page.getByRole("link", { name: /Physics/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Physics" })).toBeVisible();
  await page.goto(`${page.url()}/weak-topics`);
  const add = page.getByRole("button", { name: "+ Add weak topic" });
  await add.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Add a weak topic" });
  await expect(dialog.getByLabel("Topic")).toBeFocused();
  await page.keyboard.type("Momentum");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(add).toBeFocused();
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(dialog.getByLabel("Topic")).toHaveValue("");
  await page.keyboard.type("Momentum");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(openList(page)).toHaveCount(1);
  await expect(add).toBeFocused();
});

test("a quiz miss turns the hand-added card into 'Missed once'; 'I think my answer is right' keeps it; Got it then re-add reopens it", async ({ page, context }) => {
  const subjectUrl = await subjectWithNote(page, "Chemistry");
  await page.goto(`${subjectUrl}/quizzes?make=1`);
  const make = page.locator("dialog[open]");
  await make.getByRole("radiogroup", { name: "Question type" }).getByText("Fill in the blank", { exact: true }).click();
  await make.getByRole("button", { name: "Make quiz" }).click();
  await make.getByRole("link", { name: "Start quiz" }).click({ timeout: 15_000 });
  const q = page.getByTestId("question");
  await expect(q).toBeVisible();
  const topic = (await q.getAttribute("data-topic")) ?? (await q.locator("span.text-sm").first().textContent())!.trim();
  expect(topic.length).toBeGreaterThan(0);

  // Add the question's topic by hand (other case, extra spaces) in a second tab.
  const weak = await context.newPage();
  await weak.goto(`${subjectUrl}/weak-topics`);
  await addTopic(weak, `  ${topic.toUpperCase()}  `, "Added to your weak topics.");
  await expect(openList(weak)).toHaveCount(1);
  await expect(openList(weak).first()).toContainText("Added by you today");

  // Miss it in the quiz: same card, now "Missed once".
  await q.getByLabel("Your answer").fill("zzzz");
  await q.getByRole("button", { name: "Check" }).click();
  const fb = page.getByTestId("feedback");
  await expect(fb).toBeVisible();
  await weak.reload();
  await expect(openList(weak)).toHaveCount(1);
  await expect(openList(weak).first()).toContainText("Missed once · last today");
  await expect(openList(weak).first().getByRole("img", { name: "Last 1 try: missed" })).toBeVisible();

  // Take the miss back: the hand-added topic stays on the list.
  await fb.getByRole("button", { name: "I think my answer is right" }).click();
  await fb.getByRole("button", { name: "Count it" }).click();
  await expect(fb.getByRole("heading")).toHaveText(/^Counted as right\./);
  await weak.reload();
  await expect(openList(weak)).toHaveCount(1);
  await expect(openList(weak).first()).toContainText("Added by you today");
  await expect(openList(weak).first()).not.toContainText("Missed");

  // Got it, then add it again: back on the open list, not a second row.
  const name = (await openList(weak).first().getByRole("heading").textContent())!;
  await openList(weak).first().getByRole("button", { name: `More actions for ${name}` }).click();
  await weak.getByRole("button", { name: "Mark as got it" }).click();
  await expect(weak.getByText("All clear!")).toBeVisible();
  await addTopic(weak, topic.toLowerCase(), "Back on your list.");
  await expect(openList(weak)).toHaveCount(1);
  await expect(weak.getByRole("button", { name: /^Got it now/ })).toHaveCount(0);
  await weak.reload();
  await expect(openList(weak)).toHaveCount(1);
  await expect(weak.getByRole("button", { name: /^Got it now/ })).toHaveCount(0);
  await expectNoA11yViolations(weak);
});
