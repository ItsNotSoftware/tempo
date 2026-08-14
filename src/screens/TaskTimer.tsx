import { useState, type CSSProperties, type RefObject } from "react";
import { ChevronRight, Timer } from "lucide-react";
import { Composer } from "../components/Composer";
import { DayNav } from "../components/DayNav";
import { NowPanel } from "../components/NowPanel";
import { TaskCard } from "../components/TaskCard";
import { TaskGroup } from "../components/TaskGroup";
import {
  elapsedBetween,
  groupTone,
  isQueued,
  knownGroups,
  parseEntry,
  taskLabel,
  taskStatus,
  touchesDay,
  type Task,
  type TasksApi,
} from "../lib/tasks";
import { addDays, formatDurationShort, startOfDay } from "../lib/time";
import "./TaskTimer.css";

interface TaskTimerProps {
  api: TasksApi;
  now: number;
  /** The day in view, shared with the notebook. Midnight at its start. */
  day: number;
  onDay: (dayStart: number) => void;
  /** Owned by the shell, so ⌘K can reach it from the other screen. */
  composer: RefObject<HTMLInputElement | null>;
}

export function TaskTimer({ api, now, day, onDay, composer }: TaskTimerProps) {
  const [showDone, setShowDone] = useState(true);
  /** Where the composer files new tasks; sticky, so a run of them stays together. */
  const [composerGroup, setComposerGroup] = useState<string | null>(null);
  /** Block under the pointer, in the bar or the list — they highlight together. */
  const [pointed, setPointed] = useState<string | null>(null);
  /** The task being dragged onto a group, if any. */
  const [drag, setDrag] = useState<Drag | null>(null);

  const current = api.tasks.find((t) => taskStatus(t) === "running") ?? null;

  const today = startOfDay(now);
  const from = day;
  const to = addDays(day, 1);
  const isToday = day === today;

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

  function addTask(text: string) {
    api.add(text, composerGroup);
    // A key typed into the text wins, so move the picker with it rather than
    // leaving the chip claiming something that isn't true.
    const typed = parseEntry(text).group;
    if (typed !== null) setComposerGroup(typed);
  }

  function dropGroup(group: string, ids: string[]) {
    api.removeGroup(group, ids);
    // Nothing on the day carries the name now, so the chip can't either — the
    // picker is the day's groups, and this one just left it.
    if (composerGroup === group) setComposerGroup(null);
  }

  function addTo(group: string) {
    setComposerGroup(group);
    onDay(today);
    // The composer isn't mounted on a past day, so the focus waits a render.
    requestAnimationFrame(() => composer.current?.focus());
  }

  // --- Filing by drag ---
  //
  // Pointer events, not HTML5 drag-and-drop — the webview keeps
  // `dragDropEnabled: false`, and the screenshot harness can only drive a
  // real mouse.

  /** The group under the cursor, or null if this task is already in it. */
  function targetAt(x: number, y: number, task: Task) {
    const el = document.elementFromPoint(x, y)?.closest("[data-drop]");
    const group = el?.getAttribute("data-drop") ?? null;
    return group === null || group === task.group ? null : group;
  }

  function lift(e: React.PointerEvent, task: Task) {
    if (e.button !== 0) return;
    // A button keeps its own click; the name field is most of the row's
    // surface, so it stays a valid drag start too — going live below clears
    // whatever focus and selection the mousedown left on it.
    if ((e.target as HTMLElement).closest("button")) return;
    const from = { x: e.clientX, y: e.clientY };
    let live = false;

    const move = (m: PointerEvent) => {
      // Slack, or every click on a row would start a drag.
      if (!live && Math.hypot(m.clientX - from.x, m.clientY - from.y) < 5) return;
      if (!live) {
        live = true;
        window.getSelection()?.removeAllRanges();
        (document.activeElement as HTMLElement | null)?.blur();
      }
      setDrag({
        id: task.id,
        label: taskLabel(task),
        x: m.clientX,
        y: m.clientY,
        over: targetAt(m.clientX, m.clientY, task),
      });
    };

    const up = (u: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (!live) return;
      const onto = targetAt(u.clientX, u.clientY, task);
      // Releasing over a row would otherwise also fire its click.
      window.addEventListener("click", swallow, { capture: true, once: true });
      if (onto !== null) api.setGroup(task.id, onto);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
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

        <DayNav day={day} now={now} onDay={onDay} />
      </header>

      <Split
        blocks={blockTasks(visible)}
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
          groups={knownGroups(visible)}
          group={composerGroup}
          onGroup={setComposerGroup}
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
                Leave the picker on <em>No group</em> for a task on its own, or
                choose a group to file it under.
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
            {blockTasks(active).map((block) =>
              block.group === null ? (
                <TaskCard
                  key={block.key}
                  task={block.tasks[0]}
                  now={now}
                  from={from}
                  to={to}
                  api={api}
                  marked={pointed === block.key}
                  pointKey={block.key}
                  onPoint={setPointed}
                  readOnly={!isToday}
                  onLift={isToday ? lift : undefined}
                  lifted={drag?.id === block.tasks[0].id}
                />
              ) : (
                <TaskGroup
                  key={block.key}
                  group={block.group}
                  tasks={block.tasks}
                  now={now}
                  from={from}
                  to={to}
                  api={api}
                  marked={pointed === block.key}
                  onPoint={setPointed}
                  onAddTo={addTo}
                  onDelete={dropGroup}
                  readOnly={!isToday}
                  isDropTarget={drag?.over === block.group}
                  onLift={isToday ? lift : undefined}
                  liftedId={drag?.id ?? null}
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
                  className={`chevron${showDone ? " is-open" : ""}`}
                  size={15}
                  strokeWidth={2.5}
                />
                Done
                <span className="timer__count">{done.length}</span>
              </button>

              {/* Grouped the same as the ongoing list, but compact — the real
                  header is up there, this one just keeps its tasks together. */}
              {showDone &&
                blockTasks(done).map((block) =>
                  block.group === null ? (
                    <TaskCard
                      key={block.key}
                      task={block.tasks[0]}
                      now={now}
                      from={from}
                      to={to}
                      api={api}
                      marked={pointed === block.key}
                      pointKey={block.key}
                      onPoint={setPointed}
                      readOnly={!isToday}
                      onLift={isToday ? lift : undefined}
                      lifted={drag?.id === block.tasks[0].id}
                    />
                  ) : (
                    <TaskGroup
                      key={block.key}
                      group={block.group}
                      tasks={block.tasks}
                      now={now}
                      from={from}
                      to={to}
                      api={api}
                      marked={pointed === block.key}
                      onPoint={setPointed}
                      readOnly={!isToday}
                      compact
                      isDropTarget={drag?.over === block.group}
                      onLift={isToday ? lift : undefined}
                      liftedId={drag?.id ?? null}
                    />
                  ),
                )}
            </section>
          )}
        </>
      )}

      {drag !== null && (
        <span
          className="task-ghost"
          style={{ left: drag.x / ZOOM, top: drag.y / ZOOM } as CSSProperties}
        >
          {drag.label}
        </span>
      )}
    </div>
  );
}

interface Drag {
  id: string;
  label: string;
  x: number;
  y: number;
  /** Group under the cursor, or null when nowhere droppable. */
  over: string | null;
}

/** Matches the `zoom` on `.app`: a client x is that many px too many. */
const ZOOM = 1.15;

const swallow = (e: MouseEvent) => {
  e.stopPropagation();
  e.preventDefault();
};

/** How many blocks get their own slice before the tail is pooled. */
const SEGMENTS = 6;

interface Block {
  /** What the bar and the list point at together. */
  key: string;
  group: string | null;
  tasks: Task[];
}

/**
 * Group blocks and lone tasks, in the order the tasks were typed. Deliberately
 * not sorted by time — rows reshuffling under you as the day moves is horrible.
 */
function blockTasks(tasks: Task[]): Block[] {
  const blocks: Block[] = [];
  const byGroup = new Map<string, Block>();

  for (const task of tasks) {
    if (task.group === null) {
      blocks.push({ key: task.id, group: null, tasks: [task] });
      continue;
    }
    const existing = byGroup.get(task.group);
    if (existing !== undefined) {
      existing.tasks.push(task);
      continue;
    }
    const block: Block = { key: task.group, group: task.group, tasks: [task] };
    byGroup.set(task.group, block);
    blocks.push(block);
  }

  return blocks;
}

/**
 * Where the day went — one bar, one slice per group, biggest brightest.
 * Pointing at a slice lights its block (and the reverse), which is how you tell
 * the slices apart.
 */
function Split({
  blocks,
  now,
  from,
  to,
  total,
  pointed,
  onPoint,
}: {
  blocks: Block[];
  now: number;
  from: number;
  to: number;
  total: number;
  pointed: string | null;
  onPoint: (key: string | null) => void;
}) {
  if (total <= 0) return null;

  const ranked = blocks
    .map((block) => ({
      block,
      ms: block.tasks.reduce(
        (sum, t) => sum + elapsedBetween(t, from, to, now),
        0,
      ),
      live: block.tasks.some((t) => taskStatus(t) === "running"),
    }))
    .filter((slice) => slice.ms > 0)
    .sort((a, b) => b.ms - a.ms);

  const tail = ranked.slice(SEGMENTS).reduce((sum, slice) => sum + slice.ms, 0);

  return (
    <div className="split" onMouseLeave={() => onPoint(null)}>
      {ranked.slice(0, SEGMENTS).map(({ block, ms, live }, i) => (
        <span
          key={block.key}
          className={`split__seg${live ? " is-live" : ""}${
            pointed === block.key ? " is-pointed" : ""
          }`}
          style={{
            flexGrow: ms,
            background:
              block.group === null
                ? undefined
                : `var(--group-${groupTone(block.group)})`,
            opacity:
              pointed === block.key
                ? 1
                : pointed !== null
                  ? 0.12
                  : live
                    ? 1
                    : 0.7 - i * 0.1,
          }}
          title={`${block.group ?? block.tasks[0].name} · ${formatDurationShort(ms)}`}
          onMouseEnter={() => onPoint(block.key)}
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
