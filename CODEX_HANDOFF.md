# Codex Handoff: Skull Image Sorter Web

## Goal

Upload this static web app to GitHub and enable GitHub Pages so users can use the image sorter online without downloading an unsigned Windows executable.

## Project type

Static website. No build step. No server. No Python backend.

## Files

- `index.html` — UI structure
- `styles.css` — dark/red responsive styling
- `app.js` — all sorter logic
- `README.md` — user/deployment docs
- `.gitignore` — basic cleanup exclusions

## Key implementation details

The app uses the File System Access API:

- `showDirectoryPicker()` for source/output folders
- `FileSystemDirectoryHandle.getFileHandle()` for writing output files
- `FileSystemWritableFileStream` from `createWritable()` for copies
- `removeEntry()` for move mode and undo cleanup
- IndexedDB to remember folder handles when the browser permits it

## Features ported from the Python/Tk version

- User-selected source directory
- Hotkeys 1 / 2 / 3 to sort images
- Good / Rejected / Bad output folders
- Search by filename, with `/` separated terms
- Case-sensitive search toggle
- Single-image mode
- Gallery mode with selectable thumbnails
- Thumbnail zoom in gallery mode
- Next / previous navigation
- Filename toggle
- UI hide/show
- Key press stats for 1h / 4h / 24h
- Timer since last action
- DELETE_ prefix action using backtick
- Config-ish local UI settings persistence
- Saved folder handle restore through IndexedDB
- Duplicate filename handling with `_1`, `_2`, etc.

## Known limitations

- Works best in Chrome / Edge.
- Firefox/Safari may not support direct folder write access.
- Folder handles require explicit user permission.
- Source scanning is currently top-level only, matching the original app's basic `os.listdir` behavior.
- Undo is one action deep.
- Move mode copies then deletes source, because browser file APIs do not expose a true cross-directory move primitive.

## Suggested next Codex tasks

1. Create GitHub repo and upload this exact static app.
2. Enable GitHub Pages.
3. Add screenshots/GIF demo to README if desired.
4. Optional: add recursive folder scan toggle.
5. Optional: add named presets for labels/folders.
6. Optional: add import/export of UI settings as JSON.
7. Optional: add PWA manifest so users can install it as a browser app.

Do not upload the original Python virtual environment, `Lib/site-packages`, Python installers, caches, logs, or personal configs. That uploaded ZIP was an environment dump and is not repo-ready. Use only this static app folder.
