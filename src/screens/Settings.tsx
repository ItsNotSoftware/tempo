import { useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { FolderOpen, FolderSearch } from "lucide-react";
import { inTauri } from "../lib/vault";
import type { NotesApi } from "../lib/notes";
import "./Settings.css";

export function Settings({ notes }: { notes: NotesApi }) {
  const [busy, setBusy] = useState(false);

  async function choose() {
    // Loaded on demand: there is no folder picker in a browser, and this screen
    // still has to render there for the screenshot harness.
    const { open: pickFolder } = await import("@tauri-apps/plugin-dialog");
    const picked = await pickFolder({ directory: true, title: "Notes folder" });
    if (typeof picked !== "string") return;
    setBusy(true);
    // Take the notebook along; anything already named the same at the
    // destination is left alone rather than overwritten.
    await notes.setRoot(picked, true);
    setBusy(false);
  }

  return (
    <div className="settings">
      <h1 className="settings__title">Settings</h1>

      <section className="settings__row">
        <div className="settings__label">
          <h2>Notes folder</h2>
          <p>
            Your notes are markdown files and your folders are directories.
            Point this at Dropbox or a git repo and they sync like anything
            else. Day pages live in <code>Days/</code>.
          </p>
        </div>

        <div className="settings__value">
          <code className="settings__path">{notes.root}</code>
          <span className="settings__actions">
            <button
              className="btn btn--ghost"
              disabled={!inTauri}
              onClick={() => void revealItemInDir(notes.root)}
            >
              <FolderOpen size={15} />
              Reveal
            </button>
            <button
              className="btn btn--ghost"
              disabled={!inTauri || busy}
              onClick={() => void choose()}
            >
              <FolderSearch size={15} />
              {busy ? "Moving…" : "Change…"}
            </button>
          </span>
        </div>
      </section>
    </div>
  );
}
