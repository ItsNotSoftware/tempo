import { useEffect, useRef, useState } from "react";
import { Rail, SCREENS, type Screen } from "./components/Rail";
import { Toast, type ToastState } from "./components/Toast";
import { useEstimateAlerts, useEventAlerts } from "./lib/alerts";
import { eventTaskLabel, startEvent, useEvents, type Event } from "./lib/events";
import { useNotes } from "./lib/notes";
import { taskStatus, useTasks } from "./lib/tasks";
import { addDays, startOfDay } from "./lib/time";
import { useTray } from "./lib/tray";
import { Notes } from "./screens/Notes";
import { Schedule } from "./screens/Schedule";
import { Settings } from "./screens/Settings";
import { TaskTimer } from "./screens/TaskTimer";

export default function App() {
  const api = useTasks();
  const events = useEvents();
  const notes = useNotes();
  const running = api.tasks.some((t) => taskStatus(t) === "running");
  const now = useNow(running);

  const [screen, setScreen] = useState<Screen>("timer");
  /**
   * 0 is today; a step back is a day of history, a step forward is a day you
   * can only book into. One cursor for the whole app — step back on the timer
   * and the notebook comes with you.
   */
  const [dayOffset, setDayOffset] = useState(0);
  /** Which kept note the notebook is on; `null` is the day's own page. */
  const [kept, setKept] = useState<string | null>(null);
  const composer = useRef<HTMLInputElement>(null);

  /** What just happened, said in words — a new one replaces whatever's
   *  showing; the nonce is what makes the same message twice re-fade. */
  const [toast, setToast] = useState<ToastState | null>(null);
  const showToast = (message: string) =>
    setToast((current) => ({ message, nonce: (current?.nonce ?? 0) + 1 }));

  // Derived from `now` rather than stored, so the view re-anchors past midnight.
  const today = startOfDay(now);
  const day = addDays(today, -dayOffset);

  /** Put the clock on a booking, from wherever the ask came from — the tray,
   *  a notification's action, a booking about to start. Whatever reaches the
   *  clock this way is worth a word about it, since none of those leave the
   *  schedule on screen to show it happening. */
  const start = (event: Event) => {
    const task = startEvent(event, api, events);
    showToast(`Started · ${eventTaskLabel(task)}`);
  };

  // All three live outside the window, so they answer for today whatever day is
  // being looked at — and they keep answering while another screen is up, which
  // is why they're up here and not down in a screen.
  useTray(api, events.events, now, today, addDays(today, 1), start);
  useEstimateAlerts(api.tasks, api.groups, now);
  const soon = useEventAlerts(events.events, now, start);

  const goDay = (dayStart: number) =>
    setDayOffset(Math.round((today - startOfDay(dayStart)) / DAY));

  function toComposer() {
    setScreen("timer");
    setDayOffset(0);
    // The composer only mounts once the screen is the timer *and* the day is
    // today, so the focus has to wait for that render to happen.
    requestAnimationFrame(() => composer.current?.focus());
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();

      // The rail's own order, so a screen added there is reachable here too.
      const digit = SCREENS[Number(key) - 1];
      if (digit !== undefined) {
        e.preventDefault();
        setScreen(digit.id);
      } else if (key === "k") {
        e.preventDefault();
        toComposer();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="app">
      <Rail
        screen={screen}
        onScreen={setScreen}
        marks={{ timer: running, schedule: soon }}
      />
      <main className="app__content">
        {screen === "timer" && (
          <TaskTimer
            api={api}
            now={now}
            day={day}
            onDay={goDay}
            composer={composer}
          />
        )}

        {screen === "notes" && (
          <Notes
            api={api}
            notes={notes}
            now={now}
            day={day}
            onDay={goDay}
            kept={kept}
            onKept={setKept}
            onOpenTimer={() => setScreen("timer")}
          />
        )}

        {screen === "schedule" && (
          <Schedule
            api={api}
            events={events}
            now={now}
            day={day}
            onDay={goDay}
            onToast={showToast}
          />
        )}

        {screen === "settings" && <Settings notes={notes} />}
      </main>

      <Toast toast={toast} />
    </div>
  );
}

/** Near enough for a day offset; the rounding absorbs the DST hour. */
const DAY = 86_400_000;

/**
 * Current time. Ticks every second while something is running, and slowly the
 * rest of the time so a window left open overnight still rolls onto the new day.
 */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), active ? 1000 : 60_000);
    return () => clearInterval(id);
  }, [active]);

  return now;
}
