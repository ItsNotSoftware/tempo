import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Image } from "@tauri-apps/api/image";
import {
  Menu,
  PredefinedMenuItem,
  Submenu,
  type MenuOptions,
} from "@tauri-apps/api/menu";
import { TrayIcon } from "@tauri-apps/api/tray";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { eventsOn, nextEvent, type Event } from "./events";
import { paint } from "./mark";
import {
  elapsedBetween,
  estimates,
  isQueued,
  startedAt,
  taskLabel,
  taskStatus,
  touchesDay,
  type Task,
  type TasksApi,
} from "./tasks";
import { formatClock, formatDurationShort, formatTimeOfDay } from "./time";

/** How many idle tasks the Start submenu offers before it gets unwieldy. */
const STARTABLE = 12;
/**
 * How far ahead the menu names the next booking. Far enough to catch the one
 * you're about to walk into; not so far that the menu is an agenda.
 */
const UPCOMING = 15 * 60_000;
/** Longer labels are cut — a menu as wide as the screen is no use to anyone. */
const LABEL_CAP = 40;

/**
 * macOS scales a tray image to 18 points high, so 36 lands exactly on a retina
 * pixel grid. The 32 the Rust shell bakes in is a 1.78× resample, which is why
 * it has always looked a little soft.
 */
const ICON_PX = 36;

/** What the menu bar is saying, in one word. */
type Look = "idle" | "running" | "over";

type MenuItems = NonNullable<MenuOptions["items"]>;

/**
 * The menu bar item: the running clock in its title, and the controls you'd
 * otherwise have to find the window for. The tray itself is built by the Rust
 * shell and only dressed here, so a double mount under StrictMode is harmless.
 *
 * Outside Tauri — `pnpm dev`, the screenshot harness — there is no tray and
 * everything below no-ops.
 */
export function useTray(
  api: TasksApi,
  events: Event[],
  now: number,
  from: number,
  to: number,
  onStartEvent: (event: Event) => void,
) {
  const [tray, setTray] = useState<TrayIcon | null>(null);

  // Menu actions fire long after the render that built the menu, so they reach
  // the api through a ref rather than closing over the one they were made with.
  const latest = useRef({ api, onStartEvent });
  latest.current = { api, onStartEvent };

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

  // What the title can't say at a glance. Same rule the notification fires on,
  // so the icon and the alert can't disagree about what "over" means.
  const over =
    current !== null &&
    estimates(current, api.tasks, api.groups, now).some((e) => e.over);
  const look: Look = current === null ? "idle" : over ? "over" : "running";

  useEffect(() => {
    if (tray === null) return;
    let live = true;

    void icon(look)
      .then((image) => {
        if (!live) return;
        // Both at once: setting the image and the template flag separately
        // shows a coloured glyph getting system-tinted for a frame, or a black
        // one on a black menu bar.
        return tray.setIconWithAsTemplate(image, look === "idle");
      })
      .catch(() => {
        // The Rust shell's own icon is already on the tray, so leaving it there
        // is exactly what the app looked like before any of this.
      });

    return () => {
      live = false;
    };
    // Three values, so this fires on a real change of state and never on the tick.
  }, [tray, look]);

  const startable = api.tasks
    .filter(
      (t) => (touchesDay(t, from, to) || isQueued(t)) && taskStatus(t) === "idle",
    )
    .slice(0, STARTABLE);

  // The one booking worth a menu item: the next one, once it's close enough to
  // be the thing you're about to do. macOS may not offer the notification's
  // action button, so this is the path to its clock that always exists.
  const upcoming = nextEvent(eventsOn(events, from, to), now);
  const next =
    upcoming !== null && upcoming.start - now <= UPCOMING ? upcoming : null;

  // Rebuilding the whole menu every second would be waste, so it only happens
  // when something in it would actually read differently — which, like the
  // title, is once a minute.
  const shape = [
    current?.id ?? "",
    Math.floor(elapsed / 60_000),
    Math.floor(total / 60_000),
    startable.map((t) => `${t.id}:${label(t)}`).join(" "),
    next?.id ?? "",
  ].join("|");

  useEffect(() => {
    if (tray === null) return;
    let live = true;

    void buildMenu(current, elapsed, total, startable, next, latest).then(
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

/**
 * At most three icons ever exist. An `Image` is a resource on the Rust side, so
 * each look is drawn once and kept rather than minted every time the state
 * changes — and a rejected promise stays in the map, so a failure happens once
 * and quietly rather than on every transition for the rest of the day.
 */
const icons = new Map<Look, Promise<Image>>();

function icon(look: Look): Promise<Image> {
  const drawn = icons.get(look) ?? draw(look);
  icons.set(look, drawn);
  return drawn;
}

async function draw(look: Look): Promise<Image> {
  // A template is alpha-only: macOS tints the idle glyph to match the menu bar
  // itself, so the colour here is only something opaque to carry the shape.
  const color =
    look === "idle"
      ? "#000"
      : look === "over"
        ? themeColor("--danger", "#ff6259")
        : themeColor("--accent", "#6c9bff");

  const ctx = paint(document.createElement("canvas"), color, ICON_PX);
  if (ctx === null) throw new Error("no 2d context for the tray icon");

  const { data } = ctx.getImageData(0, 0, ICON_PX, ICON_PX);
  // Canvas hands back un-premultiplied RGBA, which is what Tauri wants. The
  // view is because `Uint8ClampedArray` isn't in the accepted union.
  return Image.new(new Uint8Array(data.buffer), ICON_PX, ICON_PX);
}

/**
 * Straight off the theme, so the menu bar and the window can't drift apart. The
 * literal fallback earns its keep: a missing variable would paint the glyph
 * black, and a black icon on a dark menu bar is an icon that isn't there.
 */
function themeColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value === "" ? fallback : value;
}

/** `TEMPO-42 · fix the parser`, cut to something a menu can carry. */
function label(task: Task): string {
  return cap(taskLabel(task));
}

function eventLabel(event: Event): string {
  const name = event.title.trim() === "" ? "Untitled" : event.title.trim();
  return cap(event.group === null ? name : `${event.group} · ${name}`);
}

function cap(text: string): string {
  return text.length > LABEL_CAP ? `${text.slice(0, LABEL_CAP - 1)}…` : text;
}

async function buildMenu(
  current: Task | null,
  elapsed: number,
  total: number,
  startable: Task[],
  next: Event | null,
  latest: { current: { api: TasksApi; onStartEvent: (event: Event) => void } },
): Promise<Menu> {
  const items: MenuItems = [];
  const api = () => latest.current.api;

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
    items.push({ text: "Pause", action: () => api().stop(current.id) });
    items.push({ text: "Finish", action: () => api().finish(current.id) });
  }

  if (next !== null) {
    items.push(await PredefinedMenuItem.new({ item: "Separator" }));
    items.push({
      text: `Next · ${formatTimeOfDay(next.start)} ${eventLabel(next)}`,
      enabled: false,
    });
    items.push({
      text: `Start ${eventLabel(next)}`,
      action: () => latest.current.onStartEvent(next),
    });
  }

  if (startable.length > 0) {
    items.push(await PredefinedMenuItem.new({ item: "Separator" }));
    items.push(
      await Submenu.new({
        text: "Start",
        items: startable.map((task) => ({
          text: label(task),
          action: () => api().start(task.id),
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
