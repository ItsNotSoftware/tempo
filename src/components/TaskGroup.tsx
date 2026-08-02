import { useState } from "react";
import { ChevronRight, Gauge, Plus, StickyNote } from "lucide-react";
import { TaskCard } from "./TaskCard";
import {
  elapsedBetween,
  groupMeta,
  groupTone,
  normalizeGroup,
  type Task,
  type TasksApi,
} from "../lib/tasks";
import { formatDurationShort, parseEstimate } from "../lib/time";

/**
 * Room for a real name without letting one push the roll-up off the row. The
 * header has ~233px to give and a bold, letter-spaced character measures a
 * little wider than `1ch`, so the cap sits well inside that and the width below
 * carries one spare character to absorb the drift.
 */
const MIN_KEY = 8;
const MAX_KEY = 22;

interface TaskGroupProps {
  group: string;
  tasks: Task[];
  now: number;
  from: number;
  to: number;
  api: TasksApi;
  marked: boolean;
  onPoint: (key: string | null) => void;
  /** Aims the composer at this group and focuses it. */
  onAddTo?: (group: string) => void;
  /** A past day is a record, not a workspace. */
  readOnly?: boolean;
  /**
   * The listing inside Done. The real header is up in the ongoing list, so this
   * one drops its controls and its estimate rather than reading as a second copy.
   */
  compact?: boolean;
}

/** A group and the tasks under it, rolled up to one line you can read at a glance. */
export function TaskGroup({
  group,
  tasks,
  now,
  from,
  to,
  api,
  marked,
  onPoint,
  onAddTo,
  readOnly = false,
  compact = false,
}: TaskGroupProps) {
  const [collapsed, setCollapsed] = useState(false);
  /** Held while editing so a rename lands once, not once per keystroke. */
  const [draft, setDraft] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const [editEstimate, setEditEstimate] = useState(false);

  const meta = groupMeta(api.groups, group);
  const spent = tasks.reduce(
    (sum, task) => sum + elapsedBetween(task, from, to, now),
    0,
  );

  // The group's own estimate is the budget when it has one; otherwise fall back
  // to what its tasks add up to, so a group is never silently unbudgeted.
  const summed = tasks.reduce((sum, task) => sum + (task.estimateMs ?? 0), 0);
  const own =
    meta.estimateMs !== null && meta.estimateMs > 0 ? meta.estimateMs : null;
  const budget = own ?? (summed > 0 ? summed : null);
  const ratio = budget === null ? 0 : spent / budget;

  const name = draft ?? group;
  const editable = !readOnly && !compact;
  const hasNotes = meta.notes.trim().length > 0;

  function commitName() {
    if (draft === null) return;
    const next = normalizeGroup(draft);
    setDraft(null);
    if (next === group) return;
    api.renameGroup(group, next === "" ? null : next);
  }

  function commitEstimate(value: string) {
    const text = value.trim();
    const ms = text === "" ? null : parseEstimate(text);
    // Garbage doesn't silently wipe it — only an empty field clears an estimate.
    if (text === "" || ms !== null) api.setGroupEstimate(group, ms);
    setEditEstimate(false);
  }

  return (
    <section
      className={`group${marked ? " is-marked" : ""}${compact ? " is-compact" : ""}`}
      onMouseEnter={() => onPoint(group)}
      onMouseLeave={() => onPoint(null)}
    >
      <div className="group__head">
        <button
          className="group__collapse"
          title={collapsed ? "Expand" : "Collapse"}
          aria-expanded={!collapsed}
          aria-label={`Toggle ${group}`}
          onClick={() => setCollapsed((shut) => !shut)}
        >
          <ChevronRight
            className={`timer__chevron${collapsed ? "" : " is-open"}`}
            size={14}
            strokeWidth={2.5}
          />
        </button>

        <i
          className="group__dot"
          style={{ background: `var(--group-${groupTone(group)})` }}
        />

        {editable ? (
          <input
            className="group__name"
            value={name}
            style={{
              // `border-box` counts padding and border inside `width`, so add
              // the chrome back; the spare character covers `ch` under-measuring.
              width: `calc(${Math.min(
                Math.max(name.length + 1, MIN_KEY),
                MAX_KEY + 1,
              )}ch + 18px)`,
            }}
            spellCheck={false}
            aria-label="Group name"
            title={
              name.length > MAX_KEY
                ? name
                : "Rename the group — every task under it moves. Empty clears it."
            }
            onChange={(e) => setDraft(e.currentTarget.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setDraft(null);
                e.currentTarget.blur();
              }
            }}
          />
        ) : (
          <span className="group__name group__name--static" title={group}>
            {group}
          </span>
        )}

        <span className="group__count">
          {tasks.length} task{tasks.length > 1 ? "s" : ""}
        </span>

        {editable && (
          <div className="group__actions">
            <button
              className="icon-btn icon-btn--sm"
              title={`Add a task to ${group}`}
              aria-label={`Add a task to ${group}`}
              onClick={() => onAddTo?.(group)}
            >
              <Plus size={16} strokeWidth={2.5} />
            </button>
            <button
              className={`icon-btn icon-btn--sm${own !== null || editEstimate ? " is-on" : ""}`}
              title={own === null ? "Set an expected time" : "Expected time"}
              aria-label="Toggle group estimate"
              aria-pressed={editEstimate}
              onClick={() => setEditEstimate((open) => !open)}
            >
              <Gauge size={16} />
            </button>
            <button
              className={`icon-btn icon-btn--sm${hasNotes || showNotes ? " is-on" : ""}`}
              title={hasNotes ? "Notes" : "Add notes"}
              aria-label="Toggle group notes"
              aria-pressed={showNotes}
              onClick={() => setShowNotes((open) => !open)}
            >
              <StickyNote size={16} />
            </button>
          </div>
        )}

        <time className="group__total">{formatDurationShort(spent)}</time>

        {editEstimate ? (
          <input
            className="task__estimate-field"
            defaultValue={own === null ? "" : formatDurationShort(own)}
            placeholder="4h"
            aria-label="Group estimate"
            spellCheck={false}
            autoFocus
            onBlur={(e) => commitEstimate(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setEditEstimate(false);
            }}
          />
        ) : (
          !compact &&
          budget !== null && (
            <span
              className={`group__estimate${ratio > 1 ? " is-over" : ""}`}
              title={
                own === null
                  ? `${formatDurationShort(budget)} — its tasks' estimates added up`
                  : `${formatDurationShort(budget)} expected for the group`
              }
            >
              / {formatDurationShort(budget)}
            </span>
          )
        )}
      </div>

      {!compact && budget !== null && (
        <div
          className={`group__budget${
            ratio > 1 ? " is-over" : ratio > 0.8 ? " is-near" : ""
          }`}
          aria-hidden
        >
          <i style={{ width: `${Math.min(100, ratio * 100)}%` }} />
        </div>
      )}

      {showNotes && (
        <textarea
          className="group__notes"
          value={meta.notes}
          rows={3}
          placeholder={`Notes for ${group}…`}
          aria-label="Group notes"
          autoFocus
          onChange={(e) => api.setGroupNotes(group, e.currentTarget.value)}
        />
      )}

      {!collapsed && (
        <div className="group__tasks">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              now={now}
              from={from}
              to={to}
              api={api}
              marked={marked}
              pointKey={group}
              onPoint={onPoint}
              readOnly={readOnly}
            />
          ))}
        </div>
      )}
    </section>
  );
}
