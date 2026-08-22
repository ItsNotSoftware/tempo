//! Everything that touches the disk.
//!
//! Two stores, because the two halves of the app want different things. The
//! tracker is one small JSON blob written whole. The notebook is a directory of
//! markdown files — folders are real directories, so the files are yours to
//! back up, sync or edit elsewhere.

use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Day pages live here rather than in the tree, so a date can't collide with a
/// folder you made. Skipped when the folder list is built.
pub const DAYS_DIR: &str = "Days";
/// Tempo's own metadata: pinning, creation order, which folders are shut.
const INDEX_FILE: &str = ".tempo.json";
const CONFIG_FILE: &str = "config.json";
const STATE_FILE: &str = "state.json";

type Res<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn app_dir(app: &AppHandle) -> Res<PathBuf> {
    let dir = app.path().app_data_dir().map_err(err)?;
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir)
}

/// Write via a temp file so an interrupted save can't truncate what was there.
fn write_atomic(path: &Path, contents: &str) -> Res<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    let temp = path.with_extension("tmp");
    fs::write(&temp, contents).map_err(err)?;
    fs::rename(&temp, path).map_err(err)
}

// --- The tracker ---

#[tauri::command]
pub fn load_state(app: AppHandle) -> Res<Option<String>> {
    let path = app_dir(&app)?.join(STATE_FILE);
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(err(e)),
    }
}

#[tauri::command]
pub fn save_state(app: AppHandle, json: String) -> Res<()> {
    write_atomic(&app_dir(&app)?.join(STATE_FILE), &json)
}

// --- Where the notebook lives ---

fn default_root(app: &AppHandle) -> PathBuf {
    app.path()
        .document_dir()
        .map(|d| d.join("Tempo"))
        .unwrap_or_else(|_| {
            app_dir(app)
                .unwrap_or_else(|_| PathBuf::from("."))
                .join("Tempo")
        })
}

fn config_path(app: &AppHandle) -> Res<PathBuf> {
    Ok(app_dir(app)?.join(CONFIG_FILE))
}

fn read_root(app: &AppHandle) -> Res<PathBuf> {
    let configured = fs::read_to_string(config_path(app)?)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|v| v.get("notesRoot")?.as_str().map(PathBuf::from));
    Ok(configured.unwrap_or_else(|| default_root(app)))
}

#[tauri::command]
pub fn notes_root(app: AppHandle) -> Res<String> {
    let root = read_root(&app)?;
    fs::create_dir_all(&root).map_err(err)?;
    Ok(root.to_string_lossy().into_owned())
}

/// Point the notebook somewhere else, optionally taking the contents along.
/// Anything already at the destination stays; only names that are free move.
#[tauri::command]
pub fn set_notes_root(app: AppHandle, path: String, move_existing: bool) -> Res<String> {
    let to = PathBuf::from(&path);
    fs::create_dir_all(&to).map_err(err)?;
    let from = read_root(&app)?;

    if move_existing && from.exists() && from != to {
        for entry in fs::read_dir(&from).map_err(err)? {
            let entry = entry.map_err(err)?;
            let target = to.join(entry.file_name());
            if !target.exists() {
                fs::rename(entry.path(), target).map_err(err)?;
            }
        }
    }

    let config = serde_json::json!({ "notesRoot": to.to_string_lossy() });
    write_atomic(&config_path(&app)?, &config.to_string())?;
    Ok(to.to_string_lossy().into_owned())
}

// --- The notebook ---

/// Relative paths only, and nothing that climbs out of the root.
fn resolve(app: &AppHandle, rel: &str) -> Res<PathBuf> {
    let rel = Path::new(rel);
    if rel
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(format!("bad path: {}", rel.display()));
    }
    Ok(read_root(app)?.join(rel))
}

#[derive(Serialize)]
pub struct FileNote {
    /// Path relative to the notes root, always "/"-separated.
    rel: String,
    body: String,
    /// Fallback creation order for a file the index has never seen.
    modified: u64,
}

#[derive(Serialize)]
pub struct Vault {
    root: String,
    notes: Vec<FileNote>,
    dirs: Vec<String>,
    /// `.tempo.json` verbatim; the frontend owns its shape.
    index: Option<String>,
}

fn walk(root: &Path, dir: &Path, notes: &mut Vec<FileNote>, dirs: &mut Vec<String>) -> Res<()> {
    for entry in fs::read_dir(dir).map_err(err)? {
        let entry = entry.map_err(err)?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .map_err(err)?
            .to_string_lossy()
            .replace('\\', "/");

        if path.is_dir() {
            // Days/2026 and Days/2026/08 are the year/month nesting, not
            // folders the user made — a bare `starts_with("Days")` would also
            // swallow a folder someone legitimately named "Daysheets".
            if rel != DAYS_DIR && !rel.starts_with("Days/") {
                dirs.push(rel);
            }
            walk(root, &path, notes, dirs)?;
        } else if path.extension().is_some_and(|e| e == "md") {
            let modified = entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_millis() as u64);
            notes.push(FileNote {
                rel,
                body: fs::read_to_string(&path).unwrap_or_default(),
                modified,
            });
        }
    }
    Ok(())
}

#[tauri::command]
pub fn load_vault(app: AppHandle) -> Res<Vault> {
    let root = read_root(&app)?;
    fs::create_dir_all(root.join(DAYS_DIR)).map_err(err)?;

    let mut notes = Vec::new();
    let mut dirs = Vec::new();
    walk(&root, &root, &mut notes, &mut dirs)?;

    Ok(Vault {
        root: root.to_string_lossy().into_owned(),
        notes,
        dirs,
        index: fs::read_to_string(root.join(INDEX_FILE)).ok(),
    })
}

#[tauri::command]
pub fn write_note(app: AppHandle, rel: String, body: String) -> Res<()> {
    write_atomic(&resolve(&app, &rel)?, &body)
}

#[tauri::command]
pub fn write_index(app: AppHandle, json: String) -> Res<()> {
    write_atomic(&read_root(&app)?.join(INDEX_FILE), &json)
}

#[tauri::command]
pub fn delete_note(app: AppHandle, rel: String) -> Res<()> {
    let path = resolve(&app, &rel)?;
    match fs::remove_file(&path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(err(e)),
        _ => {}
    }

    // A day page lives in Days/<year>/<month>/, so clearing the last one in a
    // month can leave the month empty, and then the year. "Only create those
    // folders if a day page exists" cuts both ways. Gated on the deleted path
    // being under Days: a folder the user made themselves on the shelf is
    // never there, so it's never at risk of being walked into and pruned.
    if rel.starts_with("Days/") {
        let days_root = read_root(&app)?.join(DAYS_DIR);
        let mut dir = path.parent();
        while let Some(d) = dir {
            if d == days_root || !d.starts_with(&days_root) {
                break;
            }
            let Ok(mut entries) = fs::read_dir(d) else {
                break;
            };
            if entries.next().is_some() || fs::remove_dir(d).is_err() {
                break;
            }
            dir = d.parent();
        }
    }

    Ok(())
}

/// Used for filing, renaming and moving alike — a note and a folder are the
/// same operation once they're both paths.
#[tauri::command]
pub fn move_path(app: AppHandle, from: String, to: String) -> Res<()> {
    let from = resolve(&app, &from)?;
    let to = resolve(&app, &to)?;
    if to.exists() {
        return Err(format!("{} already exists", to.display()));
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    fs::rename(from, to).map_err(err)
}

#[tauri::command]
pub fn make_dir(app: AppHandle, rel: String) -> Res<()> {
    fs::create_dir_all(resolve(&app, &rel)?).map_err(err)
}

#[tauri::command]
pub fn delete_dir(app: AppHandle, rel: String) -> Res<()> {
    let path = resolve(&app, &rel)?;
    match fs::remove_dir_all(path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(err(e)),
        _ => Ok(()),
    }
}
