import { describe, expect, it } from "vitest";
import {
  dayOf,
  dayPages,
  descends,
  folderContents,
  folderName,
  folderTree,
  keptNotes,
  migrateDayPaths,
  rootNotes,
  type Folder,
  type Note,
} from "./notes";
import { dayFile, type Snapshot } from "./vault";

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

const note = (over: Partial<Note> = {}): Note => ({
  id: "Notes/a.md",
  day: null,
  title: "A note",
  body: "",
  pinned: false,
  folder: null,
  createdAt: 1,
  ...over,
});

const folder = (path: string): Folder => ({ path, collapsed: false });

describe("keptNotes", () => {
  // Pinned first, then in the order made — never by when last touched. A shelf
  // that reshuffles under you is one you stop being able to find things on.
  it("puts pinned first, then creation order", () => {
    const shelf = keptNotes([
      note({ id: "c", createdAt: 3 }),
      note({ id: "a", createdAt: 1 }),
      note({ id: "p", createdAt: 9, pinned: true }),
      note({ id: "b", createdAt: 2 }),
    ]);

    expect(shelf.map((n) => n.id)).toEqual(["p", "a", "b", "c"]);
  });

  it("leaves day pages out of the shelf", () => {
    const pages = [note({ id: "kept" }), note({ id: "day", day: day(2026, 3, 12) })];

    expect(keptNotes(pages).map((n) => n.id)).toEqual(["kept"]);
    expect(rootNotes(pages).map((n) => n.id)).toEqual(["kept"]);
  });
});

describe("dayPages", () => {
  it("runs most recent first", () => {
    const pages = dayPages([
      note({ id: "old", day: day(2026, 3, 10) }),
      note({ id: "new", day: day(2026, 3, 12) }),
      note({ id: "kept" }),
    ]);

    expect(pages.map((n) => n.id)).toEqual(["new", "old"]);
  });
});

describe("folderTree", () => {
  const folders = [folder("Work"), folder("Work/Specs"), folder("Personal")];
  const notes = [
    note({ id: "root", createdAt: 1 }),
    note({ id: "in-work", folder: "Work", createdAt: 2 }),
    note({ id: "in-specs", folder: "Work/Specs", createdAt: 3 }),
    note({ id: "pinned-in-work", folder: "Work", createdAt: 9, pinned: true }),
  ];

  it("nests the way directories do", () => {
    const tree = folderTree(notes, folders);

    expect(tree.map((f) => f.name)).toEqual(["Work", "Personal"]);
    expect(tree[0]?.depth).toBe(0);
    expect(tree[0]?.children.map((f) => f.name)).toEqual(["Specs"]);
    expect(tree[0]?.children[0]?.depth).toBe(1);
    expect(tree[0]?.children[0]?.notes.map((n) => n.id)).toEqual(["in-specs"]);
  });

  // Pinning is pinning within a folder — the shelf's order runs inside one.
  it("keeps the shelf's order inside a folder", () => {
    const [work] = folderTree(notes, folders);
    expect(work?.notes.map((n) => n.id)).toEqual(["pinned-in-work", "in-work"]);
  });

  it("holds no day pages", () => {
    const tree = folderTree(
      [...notes, note({ id: "day", day: day(2026, 3, 12), folder: "Work" })],
      folders,
    );
    expect(tree[0]?.notes.map((n) => n.id)).not.toContain("day");
  });

  it("leaves loose notes out of the tree", () => {
    const flat = folderTree(notes, folders).flatMap((f) => [
      ...f.notes,
      ...f.children.flatMap((c) => c.notes),
    ]);
    expect(flat.map((n) => n.id)).not.toContain("root");
  });
});

describe("descends / folderContents", () => {
  it("counts a folder as inside itself", () => {
    expect(descends("Work", "Work")).toBe(true);
    expect(descends("Work/Specs", "Work")).toBe(true);
    expect(descends("Workshop", "Work")).toBe(false);
    expect(descends("Personal", "Work")).toBe(false);
  });

  // Deleting a folder takes its contents, counted in the armed label.
  it("gathers everything a folder would take with it", () => {
    const taken = folderContents(
      [
        note({ id: "in-work", folder: "Work" }),
        note({ id: "in-specs", folder: "Work/Specs" }),
        note({ id: "elsewhere", folder: "Personal" }),
        note({ id: "loose" }),
      ],
      [folder("Work"), folder("Work/Specs"), folder("Personal")],
      "Work",
    );

    expect(taken.folders.map((f) => f.path)).toEqual(["Work", "Work/Specs"]);
    expect(taken.notes.map((n) => n.id)).toEqual(["in-work", "in-specs"]);
  });

  it("names a folder by its last segment", () => {
    expect(folderName("Work/Specs")).toBe("Specs");
    expect(folderName("Work")).toBe("Work");
  });
});

describe("dayFile", () => {
  it("nests under the year and month, zero-padded", () => {
    expect(dayFile(day(2026, 8, 5))).toBe("Days/2026/08/2026-08-05.md");
  });

  it("zero-pads a two-digit month and day the same way", () => {
    expect(dayFile(day(2026, 12, 25))).toBe("Days/2026/12/2026-12-25.md");
  });
});

describe("dayOf", () => {
  it("reads the nested shape", () => {
    expect(dayOf("Days/2026/08/2026-08-05.md")).toBe(day(2026, 8, 5));
  });

  // An un-migrated file has to still read as a day page — otherwise it turns
  // up on the shelf as a kept note called "2026-08-05".
  it("reads the legacy flat shape", () => {
    expect(dayOf("Days/2026-08-05.md")).toBe(day(2026, 8, 5));
  });

  it("rejects a kept note", () => {
    expect(dayOf("Notes/Deploy steps.md")).toBeNull();
  });

  it("rejects a date-shaped name outside Days", () => {
    expect(dayOf("Personal/2026-08-05.md")).toBeNull();
  });

  it("rejects a nested Days file that isn't a date", () => {
    expect(dayOf("Days/2026/08/notes.md")).toBeNull();
  });
});

describe("migrateDayPaths", () => {
  const snapshot = (
    notes: { rel: string; body?: string; modified?: number }[],
    index: Partial<Snapshot["index"]> = {},
  ): Snapshot => ({
    root: "",
    dirs: [],
    notes: notes.map((n) => ({ body: "", modified: 0, ...n })),
    index: { notes: {}, folders: {}, ...index },
  });

  it("moves a legacy day page under its year and month, rekeying its index entry", () => {
    const before = snapshot([{ rel: "Days/2026-08-05.md", body: "hi" }], {
      notes: { "Days/2026-08-05.md": { createdAt: 5, pinned: false } },
    });

    const { snapshot: after, moves } = migrateDayPaths(before);

    expect(moves).toEqual([
      { from: "Days/2026-08-05.md", to: "Days/2026/08/2026-08-05.md" },
    ]);
    expect(after.notes).toEqual([{ rel: "Days/2026/08/2026-08-05.md", body: "hi", modified: 0 }]);
    expect(after.index.notes).toEqual({
      "Days/2026/08/2026-08-05.md": { createdAt: 5, pinned: false },
    });
  });

  it("leaves an already-migrated day page alone", () => {
    const before = snapshot([{ rel: "Days/2026/08/2026-08-05.md" }]);

    const { snapshot: after, moves } = migrateDayPaths(before);

    expect(moves).toEqual([]);
    expect(after).toBe(before);
  });

  it("leaves kept notes completely untouched", () => {
    const before = snapshot([
      { rel: "Notes/Deploy steps.md", body: "kept" },
      { rel: "Days/2026-08-05.md", body: "day" },
    ]);

    const { snapshot: after } = migrateDayPaths(before);

    expect(after.notes.find((n) => n.rel === "Notes/Deploy steps.md")).toBe(before.notes[0]);
  });

  // The nested path already has a file on it — leave the legacy one where it
  // is rather than clobber whatever's there.
  it("skips a move whose target is already taken", () => {
    const before = snapshot([
      { rel: "Days/2026-08-05.md", body: "old" },
      { rel: "Days/2026/08/2026-08-05.md", body: "new" },
    ]);

    const { snapshot: after, moves } = migrateDayPaths(before);

    expect(moves).toEqual([]);
    expect(after.notes.map((n) => n.rel).sort()).toEqual([
      "Days/2026-08-05.md",
      "Days/2026/08/2026-08-05.md",
    ]);
  });

  it("migrates more than one legacy page in a single pass", () => {
    const before = snapshot([
      { rel: "Days/2026-08-05.md" },
      { rel: "Days/2026-08-06.md" },
    ]);

    const { moves } = migrateDayPaths(before);

    expect(moves.map((m) => m.to).sort()).toEqual([
      "Days/2026/08/2026-08-05.md",
      "Days/2026/08/2026-08-06.md",
    ]);
  });
});
