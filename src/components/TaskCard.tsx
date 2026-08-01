import { useEffect, useState } from "react";
import { Check, Pause, Play, RotateCcw, StickyNote, Trash2 } from "lucide-react";
import { elapsedMs, taskStatus, type Task, type TasksApi } from "../lib/tasks";
import { formatDuration } from "../lib/time";

interface TaskCardProps {
  task: Task;
  now: number;
  api: TasksApi;
}

export function TaskCard({ task, now, api }: TaskCardProps) {
  const status = taskStatus(task);
  const [showNotes, setShowNotes] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset the delete confirmation if the user moves on without answering.
  useEffect(() => {
    if (!confirmDelete) return;
    const timer = setTimeout(() => setConfirmDelete(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmDelete]);

  const hasNotes = task.notes.trim().length > 0;

  return (
    <article className={`task task--${status}`}>
      <div className="task__row">
        {status === "done" ? (
          <button
            className="task__toggle task__toggle--done"
            title="Reopen"
            aria-label="Reopen task"
            onClick={() => api.reopen(task.id)}
          >
            {/* Reads as "done"; offers the way back once you reach for it. */}
            <Check className="swap-rest" size={15} strokeWidth={2.75} />
            <RotateCcw className="swap-hover" size={14} strokeWidth={2.25} />
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
              <Pause size={14} strokeWidth={2.25} fill="currentColor" />
            ) : (
              <Play size={14} strokeWidth={2.25} fill="currentColor" />
            )}
          </button>
        )}

        <input
          className="task__name"
          value={task.name}
          spellCheck={false}
          placeholder="Untitled"
          aria-label="Task name"
          onChange={(e) => api.rename(task.id, e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />

        <time className="task__elapsed">
          {formatDuration(elapsedMs(task, now))}
        </time>

        <div className="task__actions">
          <button
            className={`icon-btn${hasNotes || showNotes ? " is-on" : ""}`}
            title={hasNotes ? "Notes" : "Add notes"}
            aria-label="Toggle notes"
            aria-pressed={showNotes}
            onClick={() => setShowNotes((open) => !open)}
          >
            <StickyNote size={15} />
          </button>

          {status !== "done" && (
            <button
              className="icon-btn icon-btn--success"
              title="Finish"
              aria-label="Finish task"
              onClick={() => api.finish(task.id)}
            >
              <Check size={16} />
            </button>
          )}

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
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {showNotes && (
        <textarea
          className="task__notes"
          value={task.notes}
          rows={3}
          placeholder="Notes…"
          aria-label="Task notes"
          autoFocus
          onChange={(e) => api.setNotes(task.id, e.currentTarget.value)}
        />
      )}
    </article>
  );
}
