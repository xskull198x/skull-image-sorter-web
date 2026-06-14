# Skull Commission Creator

Static GitHub Pages preset picker for commission requests.

## Build

Run from the repo root:

```powershell
py -3 commission-creator\tools\build-data.py
```

The builder reads the local RPE `presets.json`, the local prompt output folder,
and the local look-book preview folders. It writes:

- `commission-creator/data/manifest.js`
- `commission-creator/assets/previews/**/*.webp`

Source gallery images are not copied. Public previews are resized WebP files
with metadata stripped.

## Public Hosting Limits

This app is static. It cannot create permanent private submission links without
a backend service or storage provider. Export currently downloads a ZIP in the
visitor's browser so they can send it manually.

Static public hosting also cannot truly protect browser-visible assets or preset
data from downloading. The build step reduces exposure by not publishing the
original images and by stripping preview metadata.
