import { useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronRight, Play, Timer } from "lucide-react";
import { NowPanel } from "../components/NowPanel";
import { TaskCard } from "../components/TaskCard";
import { elapsedMs, taskStatus, useTasks, type Task } from "../lib/tasks";
import { formatDurationShort } from "../lib/time";
import "./TaskTimer.css";

export function TaskTimer() {
  const api = useTasks();
  const [name, setName] = useState("");
  const [showDone, setShowDone] = useState(true);
  const composer = useRef<HTMLInputElement>(null);

  const running = api.tasks.filter((t) => taskStatus(t) === "running");
  const now = useNow(running.length > 0);
  const current = running[0] ?? null;

  const active = api.tasks.filter((t) => t.completedAt === null);
  const done = api.tasks
    .filter((t) => t.completedAt !== null)
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

  const total = api.tasks.reduce((sum, t) => sum + elapsedMs(t, now), 0);

  // ⌘K / Ctrl+K puts the caret in the composer from anywhere.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        composer.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function addTask(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    api.add(trimmed);
    setName("");
  }

  return (
    <div className="timer">
      {/* The hero says "tracking" loudly enough — this stays a plain summary. */}
      <header className="timer__head">
        <span className="timer__total">{formatDurationShort(total)}</span>
        <span className="timer__sub">
          {api.tasks.length === 0
            ? "nothing tracked yet"
            : `across ${api.tasks.length} task${api.tasks.length > 1 ? "s" : ""}`}
        </span>
      </header>

      <Split tasks={api.tasks} now={now} total={total} />

      {current && <NowPanel task={current} now={now} api={api} />}

      <form className="composer" onSubmit={addTask}>
        <input
          ref={composer}
          value={name}
          placeholder="What are you working on?"
          aria-label="New task name"
          spellCheck={false}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") e.currentTarget.blur();
          }}
        />
        {name.length === 0 && <kbd className="composer__hint">{HOTKEY}</kbd>}
        <button type="submit" disabled={!name.trim()}>
          <Play size={13} strokeWidth={2.5} fill="currentColor" />
          Start
        </button>
      </form>

      {api.tasks.length === 0 ? (
        <div className="timer__empty">
          <Timer size={24} strokeWidth={1.5} />
          <p>Name what you're doing and press Enter.</p>
          <p className="timer__empty-sub">The clock starts straight away.</p>
        </div>
      ) : (
        <>
          <section className="timer__list">
            {active.map((task) => (
              <TaskCard key={task.id} task={task} now={now} api={api} />
            ))}
          </section>

          {done.length > 0 && (
            <section className="timer__list">
              <button
                className="timer__section"
                aria-expanded={showDone}
                onClick={() => setShowDone((open) => !open)}
              >
                <ChevronRight
                  className={`timer__chevron${showDone ? " is-open" : ""}`}
                  size={13}
                  strokeWidth={2.5}
                />
                Done
                <span className="timer__count">{done.length}</span>
              </button>
              {showDone &&
                done.map((task) => (
                  <TaskCard key={task.id} task={task} now={now} api={api} />
                ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

const HOTKEY = navigator.userAgent.includes("Mac") ? "⌘K" : "Ctrl K";

/** How many segments get their own slice before the tail is pooled. */
const SEGMENTS = 6;

/** Where the time went — one bar, biggest slice brightest. */
function Split({
  tasks,
  now,
  total,
}: {
  tasks: Task[];
  now: number;
  total: number;
}) {
  if (total <= 0) return null;

  const ranked = tasks
    .map((task) => ({ task, ms: elapsedMs(task, now) }))
    .filter((slice) => slice.ms > 0)
    .sort((a, b) => b.ms - a.ms);

  const tail = ranked.slice(SEGMENTS).reduce((sum, slice) => sum + slice.ms, 0);

  return (
    <div className="split">
      {ranked.slice(0, SEGMENTS).map(({ task, ms }, i) => (
        <span
          key={task.id}
          className={`split__seg${taskStatus(task) === "running" ? " is-live" : ""}`}
          style={{ flexGrow: ms, opacity: 0.7 - i * 0.1 }}
          title={`${task.name} · ${formatDurationShort(ms)}`}
        />
      ))}
      {tail > 0 && (
        <span
          className="split__seg"
          style={{ flexGrow: tail, opacity: 0.16 }}
          title={`${ranked.length - SEGMENTS} more · ${formatDurationShort(tail)}`}
        />
      )}
    </div>
  );
}

/** Current time, re-rendering once a second while something is running. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  return now;
}
