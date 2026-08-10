import { CalendarClock, NotebookPen, Settings, Timer } from "lucide-react";
import { Mark } from "./Mark";
import "./Rail.css";

/** Order is the ⌘-digit order too, so the new screen goes on the end rather
 *  than moving a shortcut that's already in someone's fingers. */
export const SCREENS = [
  { id: "timer", label: "Timer", hint: "⌘1", Icon: Timer },
  { id: "notes", label: "Notes", hint: "⌘2", Icon: NotebookPen },
  { id: "schedule", label: "Schedule", hint: "⌘3", Icon: CalendarClock },
  { id: "settings", label: "Settings", hint: "⌘4", Icon: Settings },
] as const;

export type Screen = (typeof SCREENS)[number]["id"];

/**
 * The only navigation in the app. Icons rather than words — three screens don't
 * need a legend, and the window is narrow enough to want the width back.
 */
export function Rail({
  screen,
  onScreen,
  marks,
}: {
  screen: Screen;
  onScreen: (screen: Screen) => void;
  /**
   * Which screens have something happening on them: a clock running, a meeting
   * about to start. You can be looking elsewhere while either is true.
   */
  marks: Partial<Record<Screen, boolean>>;
}) {
  return (
    <nav className="rail" aria-label="Screens">
      <span className="rail__mark">
        <Mark size={17} />
      </span>

      {SCREENS.map(({ id, label, hint, Icon }) => (
        <button
          key={id}
          className={`icon-btn${screen === id ? " is-on" : ""}`}
          title={`${label}  ${hint}`}
          aria-label={label}
          aria-current={screen === id ? "page" : undefined}
          onClick={() => onScreen(id)}
        >
          <Icon size={18} />
          {marks[id] === true && <i className="pulse rail__live" />}
        </button>
      ))}
    </nav>
  );
}
