# Skull Image Sorter Web

A local-only browser version of the original Python/Tk image sorter.

The user picks a source folder, picks output folders, and sorts images with hotkeys:

- `1` -> Good
- `2` -> Rejected
- `3` -> Bad
- `A` / `Left` -> Previous image
- `D` / `Right` -> Next image
- `Space` -> Skip
- `Ctrl+Z` -> Undo last sort action
- `G` -> Gallery mode
- `N` -> Toggle filename display
- `` ` `` -> Copy/move to DELETE with `DELETE_` prefix
- `H` -> Hide/show UI
- `+` / `-` -> Gallery thumbnail zoom

## What this is

This is a static HTML/CSS/JavaScript app designed for GitHub Pages. It uses the browser's File System Access API so image files stay on the user's own computer. Nothing is uploaded to a server.

Best browser support: current Chrome / Edge / Chromium browsers.

## What this is not

This is not the original Python desktop app running on a server. GitHub Pages cannot run a Python backend. This is the correct web-hosted version for avoiding Windows unsigned-exe warnings while still letting users sort local image folders.

## Safety defaults

The app defaults to **Copy** mode instead of Move mode. Move mode is available, but it works by copying the file to the destination and then deleting the source file after a successful write.

## Folder setup

Users can either:

1. Pick one output root folder. The app creates/uses:
   - `1_good`
   - `2_rejected`
   - `3_bad`
   - `DELETE`

or:

2. Pick separate folders for 1 / 2 / 3 manually.

## GitHub Pages hosting

1. Create a new GitHub repository.
2. Upload these files to the repo root:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `README.md`
3. In GitHub, go to **Settings -> Pages**.
4. Set **Source** to `Deploy from a branch`.
5. Choose the `main` branch and `/root` folder.
6. Save.
7. Open the GitHub Pages URL after it deploys.

## Local testing

Because browser file APIs are stricter on local `file://` pages, test through a local web server:

```bash
cd skull-image-sorter-web
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Important browser limitation

A website cannot silently browse or move arbitrary files on a user's computer. The user must explicitly grant folder permissions through the browser picker. This is a security feature, not a bug.
