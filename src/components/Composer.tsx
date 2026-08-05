import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { ChevronDown, Minus, Plus } from "lucide-react";
import { groupTone, normalizeGroup } from "../lib/tasks";

const HOTKEY = navigator.userAgent.includes("Mac") ? "⌘K" : "Ctrl K";

interface ComposerProps {
  /** The day's groups, the one you touched most recently first. */
  groups: string[];
  /** What new tasks get filed under; `null` means a task on its own. */
  group: string | null;
  onGroup: (group: string | null) => void;
  onAdd: (text: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

/**
 * Add a task, and say up front where it goes. The picker stays on what you last
 * chose, so lining up five tasks under one group is pick-once then type-enter.
 */
export function Composer({
  groups,
  group,
  onGroup,
  onAdd,
  inputRef,
}: ComposerProps) {
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const picker = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!picker.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(next: string | null) {
    onGroup(next);
    setOpen(false);
    inputRef.current?.focus();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setName("");
  }

  return (
    <form className="composer" onSubmit={submit}>
      <div className="composer__picker" ref={picker}>
        <button
          type="button"
          className={`composer__group${open ? " is-open" : ""}`}
          aria-label="Choose group"
          aria-haspopup="menu"
          aria-expanded={open}
          title="Where new tasks go"
          onClick={() => setOpen((was) => !was)}
        >
          {group === null ? (
            <Minus size={13} strokeWidth={3} />
          ) : (
            <i
              className="group__dot"
              style={{ background: `var(--group-${groupTone(group)})` }}
            />
          )}
          {/* Capped so a long name can't squeeze the task field to nothing. */}
          <span className="composer__label">{group ?? "No group"}</span>
          <ChevronDown size={13} strokeWidth={2.5} />
        </button>

        {open && (
          <div className="composer__menu">
            <button
              type="button"
              className={`composer__option${group === null ? " is-on" : ""}`}
              onClick={() => pick(null)}
            >
              <Minus size={13} strokeWidth={3} />
              No group
              <span className="composer__note">on its own</span>
            </button>

            {groups.length > 0 && <div className="composer__rule" />}

            {groups.map((key) => (
              <button
                type="button"
                key={key}
                className={`composer__option${group === key ? " is-on" : ""}`}
                onClick={() => pick(key)}
              >
                <i
                  className="group__dot"
                  style={{ background: `var(--group-${groupTone(key)})` }}
                />
                <span className="composer__label">{key}</span>
              </button>
            ))}

            <div className="composer__rule" />

            {/* Typing a name here is how the first group ever gets made. */}
            <input
              className="composer__new"
              placeholder="New group…"
              aria-label="New group name"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                const key = normalizeGroup(e.currentTarget.value);
                if (key !== "") pick(key);
              }}
            />
          </div>
        )}
      </div>

      <span className="composer__divider" />

      <input
        ref={inputRef}
        value={name}
        placeholder="What are you working on?"
        aria-label="New task name"
        spellCheck={false}
        // ⌘K can land here with the menu still hanging open.
        onFocus={() => setOpen(false)}
        onChange={(e) => setName(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") e.currentTarget.blur();
        }}
      />

      {name.length === 0 && <kbd className="composer__hint">{HOTKEY}</kbd>}

      <button type="submit" disabled={!name.trim()}>
        <Plus size={18} strokeWidth={2.5} />
        Add
      </button>
    </form>
  );
}
