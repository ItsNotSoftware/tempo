import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  Menu,
  PredefinedMenuItem,
  Submenu,
  type MenuOptions,
} from "@tauri-apps/api/menu";
import { TrayIcon } from "@tauri-apps/api/tray";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  elapsedBetween,
  isQueued,
  startedAt,
  taskStatus,
  touchesDay,
  type Task,
  type TasksApi,
} from "./tasks";
import { formatClock, formatDurationShort, formatTimeOfDay } from "./time";

/** How many idle tasks the Start submenu offers before it gets unwieldy. */
const STARTABLE = 12;
/** Longer labels are cut — a menu as wide as the screen is no use to anyone. */
const LABEL_CAP = 40;

type MenuItems = NonNullable<MenuOptions["items"]>;

/**
 * The menu bar item: the running clock in its title, and the controls you'd
 * otherwise have to find the window for. The tray itself is built by the Rust
 * shell and only dressed here, so a double mount under StrictMode is harmless.
 *
 * Outside Tauri — `pnpm dev`, the screenshot harness — there is no tray and
 * everything below no-ops.
 */
export function useTray(api: TasksApi, now: number, from: number, to: number) {
  const [tray, setTray] = useState<TrayIcon | null>(null);

  // Menu actions fire long after the render that built the menu, so they reach
  // the api through a ref rather than closing over the one they were made with.
  const latest = useRef(api);
  latest.current = api;

  /** The menu currently on the tray, kept so the next build can free it. */
  const mounted = useRef<Menu | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let live = true;
    void TrayIcon.getById("main").then((found) => {
      if (live) setTray(found);
    });
    return () => {
      live = false;
    };
  }, []);

  const current = api.tasks.find((t) => taskStatus(t) === "running") ?? null;
  // Day-scoped, so the menu bar agrees with the now panel and the row.
  const elapsed = current === null ? 0 : elapsedBetween(current, from, to, now);
  const total = api.tasks.reduce(
    (sum, t) => sum + elapsedBetween(t, from, to, now),
    0,
  );

  // `HH:MM` — a seconds digit in the menu bar is just twitch in the corner of
  // your eye. Keying the effect on the rendered strings means the whole tray
  // now settles for a minute at a time.
  const clock = current === null ? null : formatClock(elapsed);
  const tooltip = current === null ? "Tempo" : `${label(current)} · ${clock}`;

  useEffect(() => {
    if (tray === null) return;
    void tray.setTitle(clock);
    void tray.setTooltip(tooltip);
  }, [tray, clock, tooltip]);

  const startable = api.tasks
    .filter(
      (t) => (touchesDay(t, from, to) || isQueued(t)) && taskStatus(t) === "idle",
    )
    .slice(0, STARTABLE);

  // Rebuilding the whole menu every second would be waste, so it only happens
  // when something in it would actually read differently — which, like the
  // title, is once a minute.
  const shape = [
    current?.id ?? "",
    Math.floor(elapsed / 60_000),
    Math.floor(total / 60_000),
    startable.map((t) => `${t.id}:${label(t)}`).join(" "),
  ].join("|");

  useEffect(() => {
    if (tray === null) return;
    let live = true;

    void buildMenu(current, elapsed, total, startable, latest).then(
      async (menu) => {
        // Beaten by a newer build while we were away.
        if (!live) return void menu.close();
        await tray.setMenu(menu);
        // A menu is a resource on the Rust side; rebuilding once a minute and
        // never letting the old one go would pile them up all day.
        await mounted.current?.close();
        mounted.current = menu;
      },
    );

    return () => {
      live = false;
    };
    // `shape` stands in for the contents; rebuilding on anything else is churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tray, shape]);
}

/** `TEMPO-42 · fix the parser`, cut to something a menu can carry. */
function label(task: Task): string {
  const name = task.name.trim() === "" ? "Untitled" : task.name.trim();
  const full = task.group === null ? name : `${task.group} · ${name}`;
  return full.length > LABEL_CAP ? `${full.slice(0, LABEL_CAP - 1)}…` : full;
}

async function buildMenu(
  current: Task | null,
  elapsed: number,
  total: number,
  startable: Task[],
  api: { current: TasksApi },
): Promise<Menu> {
  const items: MenuItems = [];

  if (current === null) {
    items.push({ text: "Nothing tracking", enabled: false });
  } else {
    const since = startedAt(current);
    items.push({ text: label(current), enabled: false });
    items.push({
      text:
        since === null
          ? formatDurationShort(elapsed)
          : `${formatDurationShort(elapsed)} · since ${formatTimeOfDay(since)}`,
      enabled: false,
    });
    items.push(await PredefinedMenuItem.new({ item: "Separator" }));
    items.push({ text: "Pause", action: () => api.current.stop(current.id) });
    items.push({ text: "Finish", action: () => api.current.finish(current.id) });
  }

  if (startable.length > 0) {
    items.push(await PredefinedMenuItem.new({ item: "Separator" }));
    items.push(
      await Submenu.new({
        text: "Start",
        items: startable.map((task) => ({
          text: label(task),
          action: () => api.current.start(task.id),
        })),
      }),
    );
  }

  items.push(await PredefinedMenuItem.new({ item: "Separator" }));
  items.push({ text: `Today · ${formatDurationShort(total)}`, enabled: false });
  items.push({ text: "Show Tempo", action: show });
  items.push(await PredefinedMenuItem.new({ item: "Quit" }));

  return Menu.new({ items });
}

/** Closing only hid the window, so bringing it back is show plus focus. */
async function show() {
  const window = getCurrentWindow();
  await window.unminimize();
  await window.show();
  await window.setFocus();
}
