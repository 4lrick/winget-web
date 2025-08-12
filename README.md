winget-export
===========

Static web UI to search winget packages, select multiple, and export a JSON you can import with:

`winget import --import-file "winget-export-YYYYMMDD-HHMMSS.json"`

How it works
------------
- Fully static (GitHub Pages-ready), no backend.
- Loads package data from `data/index.json` and searches client-side.

Use
---
- Type to search, click Select to add packages, drag to reorder.
- Click “Export winget import JSON,” then run the printed command.

Build/refresh data index
------------------------
- Local (Node + git):
  - `pnpm build:index`  # generates `data/index.json`
  - Commit and push to refresh the site
- CI (recommended):
  - `.github/workflows/update-index.yml` runs daily and on manual dispatch
  - Builds `data/index.json` and commits if changed

Develop locally
---------------
- Open `index.html` directly, or serve the folder:
  - `python3 -m http.server 5500` → http://localhost:5500/

License
-------
MIT
