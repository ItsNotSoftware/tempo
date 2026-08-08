# tempo

A small desktop app for running a working day: track time against what you're
doing, and keep the notes you write while doing it.

macOS-first, built with Tauri 2 and React. Dark only. Your data never leaves the
machine — there is no account, no server, no sync.

## What it does

**Track.** Line up the day's tasks, start one, and it counts. One timer at a
time, so switching never loses time. Tasks roll up into **groups** — a ticket
key, a project, `Workouts`, whatever you're actually organising by. Give a task
or a group an estimate and a hairline under it shows how close you are.

**Write.** A notebook alongside the timer. Each day gets a page, and the page
shows what you tracked that day. Separate from those, a short shelf of **kept
notes** — deploy steps, an on-call rota, the things you keep coming back to.

**Stay out of the way.** Closing the window hides it; the app keeps counting in
the menu bar. The icon turns blue while a task is running and red once it's past
its estimate, and the menu can pause, finish or start something without you
opening the window at all.

## Getting around

| | |
|---|---|
| `⌘1` / `⌘2` | Timer / Notes |
| `⌘K` | jump to the composer — today, from anywhere |
| `TEMPO-42 fix the parser` | files the task under `TEMPO-42` |
| `write the changelog ~45m` | sets a 45-minute estimate |

## Running it

```bash
pnpm install
pnpm tauri dev      # the app
pnpm build          # typecheck + build the frontend
pnpm tauri build    # a real .app bundle
```

## Where things are

`src/` is the whole app: `screens/` for the two screens, `components/` for the
pieces they're made of (each with its own CSS next to it), and `lib/` for state
and formatting. `src-tauri/` is a thin Rust shell — it owns the window and the
tray icon and nothing else; there are no custom commands, and no copy of your
data on that side.

State lives in `localStorage` under four `tempo.*` keys. Superseded keys are
read once and left in place, so an older build still opens your data.

`scripts/shot.mjs` screenshots the running app over CDP — `pnpm shot s.png
--states` renders every UI state onto one contact sheet, which is how changes
get reviewed.

See `CLAUDE.md` for the conventions and the reasoning behind the behaviour.
