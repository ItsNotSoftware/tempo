import { MARK_BOX, MARK_PATH } from "../lib/mark";

/** The same path the tray rasterises, so the window and the menu bar agree. */
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${MARK_BOX} ${MARK_BOX}`}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d={MARK_PATH} />
    </svg>
  );
}
