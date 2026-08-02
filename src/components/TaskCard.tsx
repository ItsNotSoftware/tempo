import { useEffect, useState } from "react";
import {
  Check,
  Gauge,
  Pause,
  Play,
  RotateCcw,
  StickyNote,
  Trash2,
} from "lucide-react";
import {
  elapsedBetween,
  elapsedMs,
  storyTone,
  taskStatus,
  type Task,
  type TasksApi,
} from "../lib/tasks";
import {
  formatDuration,
  formatDurationShort,
  parseEstimate,
} from "../lib/time";

interface TaskCardProps {
  task: Task;
  now: number;
  /** The day in view — the clock shows this slice of the task's time. */
  from: number;
  to: number;
  api: TasksApi;
  /** This task's slice of the split bar is under the pointer. */
  marked: boolean;
  /** What the bar and the list agree to point at: a story, or this task. */
  pointKey: string;
  onPoint: (key: string | null) => void;
  /** A past day is a record, not a workspace. */
  readOnly?: boolean;
  /** Outside a story block the key has to ride on the row itself. */
  showStory?: boolean;
}

export function TaskCard({
  task,
  now,
  from,
  to,
  api,
  marked,
  pointKey,
  onPoint,
  readOnly = false,
  showStory = false,
}: TaskCardProps) {
  const status = taskStatus(task);
  const [showNotes, setShowNotes] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editEstimate, setEditEstimate] = useState(false);

  // Reset the delete confirmation if the user moves on without answering.
  useEffect(() => {
    if (!confirmDelete) return;
    const timer = setTimeout(() => setConfirmDelete(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmDelete]);

  const hasNotes = task.notes.trim().length > 0;
  const dayMs = elapsedBetween(task, from, to, now);
  const totalMs = elapsedMs(task, now);

  // The clock is scoped to the day; the estimate is for the whole task, so its
  // bar reads against the total. The tooltip spells out both when they differ.
  const budget =
    task.estimateMs !== null && task.estimateMs > 0 ? task.estimateMs : null;
  const spent = budget === null ? 0 : totalMs / budget;

  function commitEstimate(value: string) {
    const text = value.trim();
    const ms = text === "" ? null : parseEstimate(text);
    // Garbage doesn't silently wipe it — only an empty field clears an estimate.
    if (text === "" || ms !== null) api.setEstimate(task.id, ms);
    setEditEstimate(false);
  }

  return (
    <article
      className={`task task--${status}${marked ? " task--marked" : ""}`}
      onMouseEnter={() => onPoint(pointKey)}
      onMouseLeave={() => onPoint(null)}
    >
      <div className="task__row">
        {readOnly ? (
          <span className="task__toggle task__toggle--static" aria-hidden>
            {status === "done" ? (
              <Check size={17} strokeWidth={2.75} />
            ) : (
              <Play size={16} strokeWidth={2.25} fill="currentColor" />
            )}
          </span>
        ) : status === "done" ? (
          <button
            className="task__toggle task__toggle--done"
            title="Reopen"
            aria-label="Reopen task"
            onClick={() => api.reopen(task.id)}
          >
            {/* Reads as "done"; offers the way back once you reach for it. */}
            <Check className="swap-rest" size={17} strokeWidth={2.75} />
            <RotateCcw className="swap-hover" size={16} strokeWidth={2.25} />
          </button>
        ) : (
          <button
            className="task__toggle"
            title={status === "running" ? "Pause" : "Start"}
            aria-label={status === "running" ? "Pause task" : "Start task"}
            onClick={() =>
              status === "running" ? api.stop(task.id) : api.start(task.id)
            }
          >
            {status === "running" ? (
              <Pause size={16} strokeWidth={2.25} fill="currentColor" />
            ) : (
              <Play size={16} strokeWidth={2.25} fill="currentColor" />
            )}
          </button>
        )}

        {showStory && task.story !== null && (
          <span
            className="task__story"
            style={{ color: `var(--story-${storyTone(task.story)})` }}
          >
            {task.story}
          </span>
        )}

        <input
          className="task__name"
          value={task.name}
          spellCheck={false}
          placeholder="Untitled"
          aria-label="Task name"
          readOnly={readOnly}
          onChange={(e) => api.rename(task.id, e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />

        <div className="task__time">
          <time
            className="task__elapsed"
            title={
              dayMs === totalMs
                ? `${formatDurationShort(totalMs)} total`
                : `${formatDurationShort(dayMs)} of ${formatDurationShort(totalMs)} total`
            }
          >
            {formatDuration(dayMs)}
          </time>

          {editEstimate ? (
            <input
              className="task__estimate-field"
              defaultValue={
                task.estimateMs === null
                  ? ""
                  : formatDurationShort(task.estimateMs)
              }
              placeholder="45m"
              aria-label="Estimate"
              spellCheck={false}
              autoFocus
              onBlur={(e) => commitEstimate(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setEditEstimate(false);
              }}
            />
          ) : (
            budget !== null && (
              <span
                className={`task__estimate${spent > 1 ? " is-over" : ""}`}
                title={`${formatDurationShort(budget)} estimated`}
              >
                / {formatDurationShort(budget)}
              </span>
            )
          )}
        </div>

        {!readOnly && (
          <div className="task__actions">
            <button
              className={`icon-btn${
                budget !== null || editEstimate ? " is-on" : ""
              }`}
              title={budget === null ? "Add an estimate" : "Estimate"}
              aria-label="Toggle estimate"
              aria-pressed={editEstimate}
              onClick={() => setEditEstimate((open) => !open)}
            >
              <Gauge size={17} />
            </button>

            <button
              className={`icon-btn${hasNotes || showNotes ? " is-on" : ""}`}
              title={hasNotes ? "Notes" : "Add notes"}
              aria-label="Toggle notes"
              aria-pressed={showNotes}
              onClick={() => setShowNotes((open) => !open)}
            >
              <StickyNote size={17} />
            </button>

            {status !== "done" && (
              <button
                className="icon-btn icon-btn--success"
                title="Finish"
                aria-label="Finish task"
                onClick={() => api.finish(task.id)}
              >
                <Check size={18} />
              </button>
            )}

            {/* Arming spells itself out — a tinted icon read as "nothing happened". */}
            <button
              className={`icon-btn icon-btn--danger${
                confirmDelete ? " is-armed" : ""
              }`}
              title={confirmDelete ? "Click again to delete" : "Delete"}
              aria-label={confirmDelete ? "Confirm delete" : "Delete task"}
              onClick={() =>
                confirmDelete ? api.remove(task.id) : setConfirmDelete(true)
              }
            >
              <Trash2 size={confirmDelete ? 15 : 17} />
              {confirmDelete && "Delete?"}
            </button>
          </div>
        )}
      </div>

      {showNotes && (
        <textarea
          className="task__notes"
          value={task.notes}
          rows={3}
          placeholder="Notes…"
          aria-label="Task notes"
          readOnly={readOnly}
          autoFocus
          onChange={(e) => api.setNotes(task.id, e.currentTarget.value)}
        />
      )}

      {budget !== null && (
        <div
          className={`task__budget${
            spent > 1 ? " is-over" : spent > 0.8 ? " is-near" : ""
          }`}
          aria-hidden
        >
          <i style={{ width: `${Math.min(100, spent * 100)}%` }} />
        </div>
      )}
    </article>
  );
}
