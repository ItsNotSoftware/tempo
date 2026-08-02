import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { TaskCard } from "./TaskCard";
import {
  elapsedBetween,
  storyTone,
  type Task,
  type TasksApi,
} from "../lib/tasks";
import { formatDurationShort } from "../lib/time";

interface StoryGroupProps {
  story: string;
  tasks: Task[];
  now: number;
  from: number;
  to: number;
  api: TasksApi;
  marked: boolean;
  onPoint: (key: string | null) => void;
  /** Aims the composer at this story and focuses it. */
  onAddTo: (story: string) => void;
  readOnly?: boolean;
}

/** A story and the tasks under it, rolled up to one line you can read at a glance. */
export function StoryGroup({
  story,
  tasks,
  now,
  from,
  to,
  api,
  marked,
  onPoint,
  onAddTo,
  readOnly = false,
}: StoryGroupProps) {
  const [collapsed, setCollapsed] = useState(false);
  /** Held while editing so a rename lands once, not once per keystroke. */
  const [draft, setDraft] = useState<string | null>(null);

  const spent = tasks.reduce(
    (sum, task) => sum + elapsedBetween(task, from, to, now),
    0,
  );
  const estimate = tasks.reduce((sum, task) => sum + (task.estimateMs ?? 0), 0);
  const over = estimate > 0 && spent > estimate;

  function commit() {
    if (draft === null) return;
    const next = draft.trim().toUpperCase();
    setDraft(null);
    if (next === story) return;
    api.renameStory(story, next === "" ? null : next);
  }

  return (
    <section
      className={`story${marked ? " is-marked" : ""}`}
      onMouseEnter={() => onPoint(story)}
      onMouseLeave={() => onPoint(null)}
    >
      <div className="story__head">
        <button
          className="story__collapse"
          title={collapsed ? "Expand" : "Collapse"}
          aria-expanded={!collapsed}
          aria-label={`Toggle ${story}`}
          onClick={() => setCollapsed((shut) => !shut)}
        >
          <ChevronRight
            className={`timer__chevron${collapsed ? "" : " is-open"}`}
            size={14}
            strokeWidth={2.5}
          />
        </button>

        <i
          className="story__dot"
          style={{ background: `var(--story-${storyTone(story)})` }}
        />

        <input
          className="story__key"
          value={draft ?? story}
          spellCheck={false}
          aria-label="Story key"
          readOnly={readOnly}
          title="Rename the story — every task under it moves. Empty clears it."
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(null);
              e.currentTarget.blur();
            }
          }}
        />

        <span className="story__count">
          {tasks.length} task{tasks.length > 1 ? "s" : ""}
        </span>

        {!readOnly && (
          <button
            className="story__add"
            title={`Add a task to ${story}`}
            aria-label={`Add a task to ${story}`}
            onClick={() => onAddTo(story)}
          >
            <Plus size={15} strokeWidth={2.5} />
          </button>
        )}

        <time className="story__total">{formatDurationShort(spent)}</time>
        {estimate > 0 && (
          <span className={`story__estimate${over ? " is-over" : ""}`}>
            / {formatDurationShort(estimate)}
          </span>
        )}
      </div>

      {!collapsed && (
        <div className="story__tasks">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              now={now}
              from={from}
              to={to}
              api={api}
              marked={marked}
              pointKey={story}
              onPoint={onPoint}
              readOnly={readOnly}
            />
          ))}
        </div>
      )}
    </section>
  );
}
