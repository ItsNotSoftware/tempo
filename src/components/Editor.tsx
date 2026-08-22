import { useEffect, useRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { openUrl } from "@tauri-apps/plugin-opener";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import {
  Annotation,
  EditorState,
  Prec,
  StateEffect,
  StateField,
  type EditorSelection,
  type Extension,
  type Range,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  placeholder as showPlaceholder,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { Markdown } from "./Markdown";
import "./Editor.css";

interface EditorProps {
  body: string;
  onChange: (value: string) => void;
  placeholder: string;
}

/**
 * The page rendered as markdown while you write in it. The syntax is still
 * there — it steps aside on every line the caret isn't on, and comes back the
 * moment you go to that line, so what you edit is always the real text.
 *
 * Keyed on the page in `Notes`, so opening another one builds a new editor
 * rather than mutating this one's document out from under the caret.
 */
export function Editor({ body, onChange, placeholder }: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  /** Through a ref, so a fresh handler each render can't rebuild the editor. */
  const emit = useRef(onChange);
  emit.current = onChange;
  /** The last text this editor produced; a late echo of it isn't an edit. */
  const echo = useRef(body);
  const opened = useRef({ body, placeholder });

  useEffect(() => {
    const editor = new EditorView({
      state: EditorState.create({
        doc: opened.current.body,
        extensions: [
          shellKeys,
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown({ base: markdownLanguage }),
          EditorView.lineWrapping,
          syntaxHighlighting(highlight),
          theme,
          showPlaceholder(opened.current.placeholder),
          EditorView.contentAttributes.of({ "aria-label": "Note" }),
          focused,
          focusTracking,
          live,
          blocks,
          openLinks,
          EditorView.updateListener.of((update) => {
            // Our own sync writes would come back through here otherwise, and
            // saving what we were just handed is a save nobody asked for.
            if (!update.docChanged) return;
            if (update.transactions.some((t) => t.annotation(Sync) === true)) return;
            const text = update.state.doc.toString();
            echo.current = text;
            emit.current(text);
          }),
        ],
      }),
      parent: host.current ?? undefined,
    });
    view.current = editor;
    return () => {
      view.current = null;
      editor.destroy();
    };
  }, []);

  // CodeMirror owns the document. Only a body that isn't this editor's own
  // work coming back gets written in — the deferred save arrives a few
  // keystrokes behind, and replacing the text would take the caret with it.
  useEffect(() => {
    const editor = view.current;
    if (editor === null || body === echo.current) return;
    if (editor.state.doc.toString() === body) return;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: body },
      annotations: Sync.of(true),
    });
    echo.current = body;
  }, [body]);

  return <div className="editor" ref={host} />;
}

/** Marks a change as ours, so it isn't echoed straight back to the vault. */
const Sync = Annotation.define<boolean>();

// --- Focus ---
//
// Markers only step aside while you're actually in the page: a caret parked at
// position 0 of a page you haven't touched shouldn't reveal its first line.
// Focus isn't part of the editor state, so this puts it there.

const setFocused = StateEffect.define<boolean>();

const focused = StateField.define<boolean>({
  create: () => false,
  update: (on, tr) =>
    tr.effects.reduce((value, e) => (e.is(setFocused) ? e.value : value), on),
});

const focusTracking = EditorView.focusChangeEffect.of((_state, focusing) =>
  setFocused.of(focusing),
);

// --- The shell's shortcuts ---

/**
 * Navigation belongs to the shell whatever has focus. CodeMirror never stops
 * propagation, so `App`'s and `Notes`' window listeners hear these regardless —
 * claiming them here only stops an editor binding acting on the way past.
 */
const SHELL_KEYS = new Set(["e", "\\", "k", "1", "2", "3", "4"]);

const shellKeys = Prec.highest(
  EditorView.domEventHandlers({
    keydown: (e) =>
      (e.metaKey || e.ctrlKey) && SHELL_KEYS.has(e.key.toLowerCase()),
  }),
);

// --- Links ---

/**
 * The one way out of the page. A written link carries its target only while
 * its syntax is hidden, so clicking one opens it and clicking the line you're
 * already editing puts the caret down; a link inside a rendered table is a
 * real anchor and comes through the same door. A plain <a> left to itself
 * would navigate the webview, with no way back.
 */
const openLinks = EditorView.domEventHandlers({
  mousedown: (e) => {
    const found = (e.target as HTMLElement | null)?.closest("[data-href], a[href]");
    const href = found?.getAttribute("data-href") ?? found?.getAttribute("href");
    if (href === null || href === undefined) return false;
    e.preventDefault();
    // No shell to ask when the page is served to a plain browser.
    openUrl(href).catch(() => window.open(href, "_blank"));
    return true;
  },
});

// --- Theme ---

/**
 * Every colour is a token from `index.css`, so repainting the palette carries
 * the editor with it. Shapes and sizes a class can hold live in `Editor.css`;
 * this is the chrome CodeMirror builds for itself.
 */
const theme = EditorView.theme(
  {
    "&": {
      height: "100%",
      color: "var(--text)",
      backgroundColor: "transparent",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily: "inherit",
      fontSize: "16px",
      lineHeight: "1.7",
      overflow: "auto",
    },
    ".cm-content": {
      padding: "0",
      caretColor: "var(--accent)",
      // Selection is off app-wide, and a contenteditable is not an input.
      userSelect: "text",
    },
    ".cm-line": { padding: "0" },
    ".cm-content ::selection": { backgroundColor: "var(--accent-soft)" },
    ".cm-placeholder": { color: "var(--text-faint)" },
  },
  { dark: true },
);

/** Token colours only — the shapes are decoration classes. */
const highlight = HighlightStyle.define([
  { tag: tags.processingInstruction, color: "var(--text-faint)" },
  { tag: tags.labelName, color: "var(--text-faint)" },
  { tag: tags.contentSeparator, color: "var(--text-faint)" },
  { tag: tags.string, color: "var(--text-muted)" },
  { tag: tags.url, color: "var(--accent)" },
  { tag: tags.link, color: "var(--accent)" },
  { tag: tags.monospace, color: "var(--text)" },
]);

// --- Widgets ---

/** Stands in for `[ ]`, and ticks the source it stands in for. */
class CheckWidget extends WidgetType {
  constructor(
    readonly on: boolean,
    readonly at: number,
  ) {
    super();
  }

  eq(other: CheckWidget) {
    return other.on === this.on && other.at === this.at;
  }

  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-md-check";
    box.checked = this.on;
    // Ticking shouldn't also drag the caret onto the line and unwrap it.
    box.addEventListener("mousedown", (e) => e.preventDefault());
    box.addEventListener("click", () =>
      view.dispatch({
        changes: { from: this.at + 1, to: this.at + 2, insert: this.on ? " " : "x" },
      }),
    );
    return box;
  }

  ignoreEvent() {
    return true;
  }
}

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM() {
    const dot = document.createElement("span");
    dot.className = "cm-md-bullet";
    dot.textContent = "•";
    return dot;
  }

  /** Clicking a bullet is aiming at the line, so let the caret land. */
  ignoreEvent() {
    return false;
  }
}

/**
 * A table or a whole-line image, drawn by the same `Markdown` the read view
 * was — one renderer, so the two can't drift, and a live editor doesn't cost
 * the tables the read view already knew how to draw.
 *
 * Rendered to a string rather than into a React root: CodeMirror measures a
 * widget the moment it is handed one, and a root started from inside an effect
 * commits a tick too late to be the height that gets measured.
 */
class BlockWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }

  eq(other: BlockWidget) {
    return other.source === this.source;
  }

  toDOM() {
    const box = document.createElement("div");
    box.className = "cm-md-block";
    box.innerHTML = renderToStaticMarkup(<Markdown body={this.source} />);
    return box;
  }

  /**
   * Nothing to ignore: a link inside goes through `openLinks` like any other,
   * and a click anywhere else is you asking to edit the table, so the caret
   * lands in it and the source comes back with it.
   */
  ignoreEvent() {
    return false;
  }
}

// --- Decorations ---

const HIDE = Decoration.replace({});
const BULLET = Decoration.replace({ widget: new BulletWidget() });
const LINK = Decoration.mark({ class: "cm-md-link" });

/** Nodes that are only a span of styled text. */
const SPANS = new Map<string, Decoration>([
  ["StrongEmphasis", Decoration.mark({ class: "cm-md-strong" })],
  ["Emphasis", Decoration.mark({ class: "cm-md-em" })],
  ["Strikethrough", Decoration.mark({ class: "cm-md-strike" })],
  ["InlineCode", Decoration.mark({ class: "cm-md-code" })],
]);

/** Nodes that dress every line they cover. */
const BLOCK_LINES = new Map<string, Decoration>([
  ["Blockquote", Decoration.line({ class: "cm-md-quote" })],
  ["FencedCode", Decoration.line({ class: "cm-md-fence" })],
]);

/** `# ` through `###### `, sized on the line the text is on. */
const HEADINGS = [1, 2, 3, 4, 5, 6].map((n) =>
  Decoration.line({ class: `cm-md-h${n}` }),
);

const HEADING = /^(?:ATX|Setext)Heading([1-6])$/;
const SCHEME = /^[a-z][\w+.-]*:/i;

/** The lines whose syntax stays on screen: the ones you have hold of. */
function revealed(state: EditorState): Set<number> {
  const lines = new Set<number>();
  if (!state.field(focused)) return lines;
  for (const range of state.selection.ranges) {
    const last = state.doc.lineAt(range.to).number;
    for (let n = state.doc.lineAt(range.from).number; n <= last; n++) lines.add(n);
  }
  return lines;
}

function touches(selection: EditorSelection, from: number, to: number): boolean {
  return selection.ranges.some((r) => r.to >= from && r.from <= to);
}

/** `## ` hides as one thing — the space belongs to the marker, not the title. */
function withSpace(doc: Text, to: number, limit: number): number {
  let end = to;
  while (end < limit && doc.sliceString(end, end + 1) === " ") end++;
  return end;
}

/** Tagged with its target only while it reads as a link rather than as source. */
function link(href: string | null, rendered: boolean): Decoration {
  return href === null || !rendered
    ? LINK
    : Decoration.mark({ class: "cm-md-link", attributes: { "data-href": href } });
}

/**
 * Everything that lives inside a line: the markers to hide, and the classes
 * that do the rendering. Built over the viewport, because a page only grows.
 */
function inline(view: EditorView): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  const open = revealed(state);
  const marks: Range<Decoration>[] = [];
  const bare = (pos: number) => !open.has(doc.lineAt(pos).number);

  // One pass over the whole visible span rather than one per range: a node
  // straddling the gap between two would otherwise be decorated twice.
  const seen = view.visibleRanges;
  if (seen.length === 0) return Decoration.none;

  syntaxTree(state).iterate({
    from: seen[0].from,
    to: seen[seen.length - 1].to,
    enter: (node) => {
      const { name, from, to } = node;

      const heading = HEADING.exec(name);
      if (heading !== null) {
        marks.push(HEADINGS[Number(heading[1]) - 1].range(doc.lineAt(from).from));
        return;
      }

      const span = SPANS.get(name);
      if (span !== undefined) {
        marks.push(span.range(from, to));
        return;
      }

      const dressed = BLOCK_LINES.get(name);
      if (dressed !== undefined) {
        for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++)
          marks.push(dressed.range(doc.line(n).from));
        return;
      }

      if (name === "HeaderMark" || name === "QuoteMark") {
        if (!bare(from)) return;
        const line = doc.lineAt(from);
        // A closing `##` has nothing after it worth swallowing.
        const end = from === line.from ? withSpace(doc, to, line.to) : to;
        if (from < end) marks.push(HIDE.range(from, end));
        return;
      }

      if (name === "EmphasisMark" || name === "StrikethroughMark") {
        if (bare(from)) marks.push(HIDE.range(from, to));
        return;
      }

      if (name === "CodeMark") {
        // A fence owns its line; hiding it would leave a blank one behind.
        if (bare(from) && node.node.parent?.name === "InlineCode")
          marks.push(HIDE.range(from, to));
        return;
      }

      if (name === "ListMark") {
        const text = doc.sliceString(from, to);
        // On a task the checkbox stands in for the bullet, as it does in the
        // read view — two of them would be one mark too many.
        const task = node.node.nextSibling?.name === "Task";
        if (bare(from) && !task && (text === "-" || text === "*" || text === "+"))
          marks.push(BULLET.range(from, to));
        return;
      }

      if (name === "TaskMarker") {
        if (!bare(from)) return;
        const on = doc.sliceString(from + 1, from + 2) !== " ";
        const box = Decoration.replace({ widget: new CheckWidget(on, from) });
        marks.push(box.range(from, to));
        return;
      }

      if (name === "Link") {
        const url = node.node.getChild("URL");
        const href = url === null ? null : doc.sliceString(url.from, url.to);
        marks.push(link(href, bare(from)).range(from, to));
        return;
      }

      if (name === "URL" || name === "LinkTitle") {
        const parent = node.node.parent?.name;
        // A bare URL is already its own rendering, so only the target is
        // added — and only when it says what to open it with. Guessing a
        // scheme onto `www.` reads the same as guessing one onto an address.
        if (parent !== "Link" && parent !== "Image") {
          if (name !== "URL") return;
          const text = doc.sliceString(from, to);
          const href = SCHEME.test(text) ? text : null;
          marks.push(link(href, bare(from)).range(from, to));
          return;
        }
        if (bare(from)) marks.push(HIDE.range(from, to));
        return;
      }

      if (name === "LinkMark" && bare(from)) marks.push(HIDE.range(from, to));
    },
  });

  return Decoration.set(marks, true);
}

const live = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = inline(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.focusChanged ||
        // The tree arrives behind the text on a long page.
        syntaxTree(update.startState) !== syntaxTree(update.state)
      )
        this.decorations = inline(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/**
 * Tables and whole-line images, replaced by the thing they describe. These
 * cross line breaks, which a view plugin isn't allowed to do, so they are
 * computed from the state instead.
 */
function blockSet(state: EditorState): DecorationSet {
  const doc = state.doc;
  const on = state.field(focused);
  const marks: Range<Decoration>[] = [];

  syntaxTree(state).iterate({
    enter: (node) => {
      const { name, from, to } = node;
      if (name !== "Table" && name !== "Image") return;
      const first = doc.lineAt(from);
      const last = doc.lineAt(to);
      const source = doc.sliceString(first.from, last.to);
      // An image with prose around it is part of the sentence, not a block.
      if (name === "Image" && source.trim() !== doc.sliceString(from, to).trim())
        return false;
      if (on && touches(state.selection, first.from, last.to)) return false;
      const drawn = Decoration.replace({
        widget: new BlockWidget(source),
        block: true,
      });
      marks.push(drawn.range(first.from, last.to));
      return false;
    },
  });

  return Decoration.set(marks, true);
}

const blocks: Extension = EditorView.decorations.compute(
  [focused, "doc", "selection"],
  blockSet,
);
