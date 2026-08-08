import { NotebookPen, Timer } from "lucide-react";
import { Mark } from "./Mark";

export type Screen = "timer" | "notes";

const SCREENS = [
  { id: "timer", label: "Timer", hint: "⌘1", Icon: Timer },
  { id: "notes", label: "Notes", hint: "⌘2", Icon: NotebookPen },
] as const;

/**
 * The only navigation in the app. Icons rather than words — two screens don't
 * need a legend, and the window is narrow enough to want the width back.
 */
export function Rail({
  screen,
  onScreen,
  running,
}: {
  screen: Screen;
  onScreen: (screen: Screen) => void;
  /** Something is counting on a screen you might not be looking at. */
  running: boolean;
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
          {id === "timer" && running && <i className="pulse rail__live" />}
        </button>
      ))}
    </nav>
  );
}
