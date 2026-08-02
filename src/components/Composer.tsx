import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { ChevronDown, Minus, Plus } from "lucide-react";
import { storyTone } from "../lib/tasks";

const HOTKEY = navigator.userAgent.includes("Mac") ? "⌘K" : "Ctrl K";

interface ComposerProps {
  /** Stories already in use, most recently touched first. */
  stories: string[];
  /** What new tasks get filed under; `null` means a standalone task. */
  story: string | null;
  onStory: (story: string | null) => void;
  onAdd: (text: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

/**
 * Add a task, and say up front where it goes. The picker stays on what you last
 * chose, so lining up five tasks under one story is pick-once then type-enter.
 */
export function Composer({
  stories,
  story,
  onStory,
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
    onStory(next);
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
          className={`composer__story${open ? " is-open" : ""}`}
          aria-label="Choose story"
          aria-haspopup="menu"
          aria-expanded={open}
          title="Where new tasks go"
          onClick={() => setOpen((was) => !was)}
        >
          {story === null ? (
            <>
              <Minus size={13} strokeWidth={3} />
              No story
            </>
          ) : (
            <>
              <i
                className="story__dot"
                style={{ background: `var(--story-${storyTone(story)})` }}
              />
              {story}
            </>
          )}
          <ChevronDown size={13} strokeWidth={2.5} />
        </button>

        {open && (
          <div className="composer__menu">
            <button
              type="button"
              className={`composer__option${story === null ? " is-on" : ""}`}
              onClick={() => pick(null)}
            >
              <Minus size={13} strokeWidth={3} />
              No story
              <span className="composer__note">on its own</span>
            </button>

            {stories.length > 0 && <div className="composer__rule" />}

            {stories.map((key) => (
              <button
                type="button"
                key={key}
                className={`composer__option${story === key ? " is-on" : ""}`}
                onClick={() => pick(key)}
              >
                <i
                  className="story__dot"
                  style={{ background: `var(--story-${storyTone(key)})` }}
                />
                {key}
              </button>
            ))}

            <div className="composer__rule" />

            {/* Typing a key here is how the first story ever gets made. */}
            <input
              className="composer__new"
              placeholder="New story…"
              aria-label="New story key"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                const key = e.currentTarget.value.trim().toUpperCase();
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
