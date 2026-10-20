import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoRepo } from "../repo/demo";
import type { Repo } from "../repo/types";

let repo: Repo;
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("../session", () => ({ getRepo: async () => repo }));
const { logStudySession } = await import("./timer");

const MIN = 60_000;
function round(o: Record<string, unknown> = {}) {
  const end = Date.now() - MIN;
  return {
    clientKey: crypto.randomUUID(), subjectId: null, kind: "focus", plannedSec: 1500, focusedSec: 1500, completed: true,
    startedAt: new Date(end - 25 * MIN).toISOString(), endedAt: new Date(end).toISOString(), ...o,
  };
}

describe("logStudySession", () => {
  let subjectId: string;
  beforeEach(async () => {
    repo = demoRepo(crypto.randomUUID());
    subjectId = (await repo.createSubject({ name: "Bio", colour: "mint", emoji: "🧬" })).id;
  });

  it("saves a round under the student's subject", async () => {
    const r = round({ subjectId });
    const res = await logStudySession(r);
    expect(res).toMatchObject({ ok: true, subjectId });
    const [saved] = await repo.listStudySessions({ endedSince: new Date(0).toISOString() });
    expect(saved).toMatchObject({ clientKey: r.clientKey, subjectId, kind: "focus", focusedSec: 1500, completed: true });
  });

  it("a retried save logs once", async () => {
    const r = round({ subjectId });
    const a = await logStudySession(r);
    const b = await logStudySession({ ...r, focusedSec: 900 });
    expect(a.ok && b.ok && a.id === b.id).toBe(true);
    const all = await repo.listStudySessions({ endedSince: new Date(0).toISOString() });
    expect(all).toHaveLength(1);
    expect(all[0].focusedSec).toBe(1500);
  });

  it("another student's subject, or a deleted one, is logged as No subject", async () => {
    const mine = repo;
    const other = demoRepo(crypto.randomUUID());
    const theirs = (await other.createSubject({ name: "Law", colour: "sky", emoji: "⚖️" })).id;
    repo = mine;
    expect(await logStudySession(round({ subjectId: theirs }))).toMatchObject({ ok: true, subjectId: null });
    expect(await other.listStudySessions({ endedSince: new Date(0).toISOString() })).toEqual([]);
    await repo.deleteSubject(subjectId);
    expect(await logStudySession(round({ subjectId }))).toMatchObject({ ok: true, subjectId: null });
  });

  it("deleting a subject keeps its time as No subject", async () => {
    await logStudySession(round({ subjectId }));
    await repo.deleteSubject(subjectId);
    const [s] = await repo.listStudySessions({ endedSince: new Date(0).toISOString() });
    expect(s.subjectId).toBeNull();
  });

  it("refuses rounds that can't be real", async () => {
    const now = Date.now();
    const bad = [
      round({ focusedSec: 59 }),
      round({ focusedSec: 1600 }), // longer than planned
      round({ plannedSec: 11_000, focusedSec: 1500 }),
      round({ startedAt: new Date(now - 10 * MIN).toISOString(), endedAt: new Date(now - 5 * MIN).toISOString(), focusedSec: 1500 }), // more than it lasted
      round({ endedAt: new Date(now + 30 * MIN).toISOString(), startedAt: new Date(now).toISOString() }), // hasn't ended
      round({ startedAt: new Date(now - 40 * 24 * 60 * MIN).toISOString(), endedAt: new Date(now - 40 * 24 * 60 * MIN + 25 * MIN).toISOString() }), // too old
      round({ kind: "nap" }),
      round({ clientKey: "not-a-uuid" }),
      round({ subjectId: "x" }),
      round({ endedAt: "yesterday" }),
      "nonsense",
    ];
    for (const b of bad) expect(await logStudySession(b)).toMatchObject({ ok: false });
    expect(await repo.listStudySessions({ endedSince: new Date(0).toISOString() })).toEqual([]);
  });

  it("export and delete-account include study sessions", async () => {
    await logStudySession(round({ subjectId }));
    expect((await repo.exportAll()).studySessions).toHaveLength(1);
    const { demoDeleteUser } = await import("../repo/demo");
    demoDeleteUser(repo.userId);
    expect(await repo.listStudySessions({ endedSince: new Date(0).toISOString() })).toEqual([]);
  });
});
