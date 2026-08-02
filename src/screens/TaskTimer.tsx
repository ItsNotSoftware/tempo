import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Timer } from "lucide-react";
import { Composer } from "../components/Composer";
import { NowPanel } from "../components/NowPanel";
import { StoryGroup } from "../components/StoryGroup";
import { TaskCard } from "../components/TaskCard";
import {
  elapsedBetween,
  isQueued,
  knownStories,
  parseEntry,
  storyTone,
  taskStatus,
  touchesDay,
  useTasks,
  type Task,
} from "../lib/tasks";
import {
  addDays,
  formatDay,
  formatDurationShort,
  startOfDay,
} from "../lib/time";
import "./TaskTimer.css";

export function TaskTimer() {
  const api = useTasks();
  const [showDone, setShowDone] = useState(true);
  /** Where the composer files new tasks; sticky, so a run of them stays together. */
  const [composerStory, setComposerStory] = useState<string | null>(null);
  /** Group under the pointer, in the bar or the list — they highlight together. */
  const [pointed, setPointed] = useState<string | null>(null);
  /** 0 is today; every step back is one more day of history. */
  const [dayOffset, setDayOffset] = useState(0);
  const composer = useRef<HTMLInputElement>(null);

  const running = api.tasks.filter((t) => taskStatus(t) === "running");
  const now = useNow(running.length > 0);
  const current = running[0] ?? null;

  // Derived from `now` rather than stored, so the view re-anchors past midnight.
  const from = addDays(startOfDay(now), -dayOffset);
  const to = addDays(from, 1);
  const isToday = dayOffset === 0;

  // Today is the workspace, so tasks lined up but never started ride along —
  // the queue must not vanish overnight. A past day is only what happened on it.
  const visible = api.tasks.filter(
    (t) => touchesDay(t, from, to) || (isToday && isQueued(t)),
  );

  const active = visible.filter((t) => t.completedAt === null);
  const done = visible
    .filter((t) => t.completedAt !== null)
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

  const total = visible.reduce(
    (sum, t) => sum + elapsedBetween(t, from, to, now),
    0,
  );
  const estimate = visible.reduce((sum, t) => sum + (t.estimateMs ?? 0), 0);

  // ⌘K / Ctrl+K puts the caret in the composer from anywhere.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setDayOffset(0);
        composer.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function addTask(text: string) {
    api.add(text, composerStory);
    // A key typed into the text wins, so move the picker with it rather than
    // leaving the chip claiming something that isn't true.
    const typed = parseEntry(text).story;
    if (typed !== null) setComposerStory(typed);
  }

  function addTo(story: string) {
    setComposerStory(story);
    setDayOffset(0);
    composer.current?.focus();
  }

  return (
    <div className="timer">
      {/* The hero says "tracking" loudly enough — this stays a plain summary. */}
      <header className="timer__head">
        <span className="timer__total">{formatDurationShort(total)}</span>
        {estimate > 0 && (
          <span
            className={`timer__estimate${total > estimate ? " is-over" : ""}`}
          >
            / {formatDurationShort(estimate)}
          </span>
        )}
        <span className="timer__sub">
          {visible.length === 0
            ? isToday
              ? "nothing tracked yet"
              : "nothing tracked"
            : `across ${visible.length} task${visible.length > 1 ? "s" : ""}`}
        </span>

        <div className="timer__days">
          <button
            className="icon-btn"
            title="Previous day"
            aria-label="Previous day"
            onClick={() => setDayOffset((d) => d + 1)}
          >
            <ChevronLeft size={17} />
          </button>
          <button
            className="timer__day"
            disabled={isToday}
            title={isToday ? undefined : "Back to today"}
            onClick={() => setDayOffset(0)}
          >
            {formatDay(from, now)}
          </button>
          <button
            className="icon-btn"
            title="Next day"
            aria-label="Next day"
            disabled={isToday}
            onClick={() => setDayOffset((d) => Math.max(0, d - 1))}
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </header>

      <Split
        groups={groupTasks(visible)}
        now={now}
        from={from}
        to={to}
        total={total}
        pointed={pointed}
        onPoint={setPointed}
      />

      {isToday && current && (
        <NowPanel task={current} now={now} from={from} to={to} api={api} />
      )}

      {isToday && (
        <Composer
          stories={knownStories(api.tasks)}
          story={composerStory}
          onStory={setComposerStory}
          onAdd={addTask}
          inputRef={composer}
        />
      )}

      {visible.length === 0 ? (
        <div className="timer__empty">
          <Timer size={32} strokeWidth={1.5} />
          {isToday ? (
            <>
              <p>Add a task to get started.</p>
              <p className="timer__empty-sub">
                Leave it on <em>No story</em> for a standalone task, or pick one
                to group it.
              </p>
            </>
          ) : (
            <>
              <p>Nothing tracked on this day.</p>
              <p className="timer__empty-sub">
                Use the arrows to look around, or jump back to today.
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          <section className="timer__list">
            {groupTasks(active).map((group) =>
              group.story === null ? (
                <TaskCard
                  key={group.key}
                  task={group.tasks[0]}
                  now={now}
                  from={from}
                  to={to}
                  api={api}
                  marked={pointed === group.key}
                  pointKey={group.key}
                  onPoint={setPointed}
                  readOnly={!isToday}
                />
              ) : (
                <StoryGroup
                  key={group.key}
                  story={group.story}
                  tasks={group.tasks}
                  now={now}
                  from={from}
                  to={to}
                  api={api}
                  marked={pointed === group.key}
                  onPoint={setPointed}
                  onAddTo={addTo}
                  readOnly={!isToday}
                />
              ),
            )}
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
                  size={15}
                  strokeWidth={2.5}
                />
                Done
                <span className="timer__count">{done.length}</span>
              </button>
              {showDone &&
                done.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    now={now}
                    from={from}
                    to={to}
                    api={api}
                    marked={pointed === (task.story ?? task.id)}
                    pointKey={task.story ?? task.id}
                    onPoint={setPointed}
                    readOnly={!isToday}
                    showStory
                  />
                ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** How many segments get their own slice before the tail is pooled. */
const SEGMENTS = 6;

interface Group {
  /** What the bar and the list point at together. */
  key: string;
  story: string | null;
  tasks: Task[];
}

/**
 * Story blocks and lone tasks, in the order the tasks were typed. Deliberately
 * not sorted by time — rows reshuffling under you as the day moves is horrible.
 */
function groupTasks(tasks: Task[]): Group[] {
  const groups: Group[] = [];
  const byStory = new Map<string, Group>();

  for (const task of tasks) {
    if (task.story === null) {
      groups.push({ key: task.id, story: null, tasks: [task] });
      continue;
    }
    const existing = byStory.get(task.story);
    if (existing !== undefined) {
      existing.tasks.push(task);
      continue;
    }
    const group: Group = { key: task.story, story: task.story, tasks: [task] };
    byStory.set(task.story, group);
    groups.push(group);
  }

  return groups;
}

/**
 * Where the day went — one bar, one slice per story, biggest brightest.
 * Pointing at a slice lights its block (and the reverse), which is how you tell
 * the slices apart.
 */
function Split({
  groups,
  now,
  from,
  to,
  total,
  pointed,
  onPoint,
}: {
  groups: Group[];
  now: number;
  from: number;
  to: number;
  total: number;
  pointed: string | null;
  onPoint: (key: string | null) => void;
}) {
  if (total <= 0) return null;

  const ranked = groups
    .map((group) => ({
      group,
      ms: group.tasks.reduce(
        (sum, t) => sum + elapsedBetween(t, from, to, now),
        0,
      ),
      live: group.tasks.some((t) => taskStatus(t) === "running"),
    }))
    .filter((slice) => slice.ms > 0)
    .sort((a, b) => b.ms - a.ms);

  const tail = ranked.slice(SEGMENTS).reduce((sum, slice) => sum + slice.ms, 0);

  return (
    <div className="split" onMouseLeave={() => onPoint(null)}>
      {ranked.slice(0, SEGMENTS).map(({ group, ms, live }, i) => (
        <span
          key={group.key}
          className={`split__seg${live ? " is-live" : ""}${
            pointed === group.key ? " is-pointed" : ""
          }`}
          style={{
            flexGrow: ms,
            background:
              group.story === null
                ? undefined
                : `var(--story-${storyTone(group.story)})`,
            opacity:
              pointed === group.key
                ? 1
                : pointed !== null
                  ? 0.12
                  : live
                    ? 1
                    : 0.7 - i * 0.1,
          }}
          title={`${group.story ?? group.tasks[0].name} · ${formatDurationShort(ms)}`}
          onMouseEnter={() => onPoint(group.key)}
        />
      ))}
      {tail > 0 && (
        <span
          className="split__seg"
          style={{ flexGrow: tail, opacity: pointed === null ? 0.16 : 0.1 }}
          title={`${ranked.length - SEGMENTS} more · ${formatDurationShort(tail)}`}
        />
      )}
    </div>
  );
}

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
