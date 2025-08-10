winget-web
============

Browse Windows Package Manager (winget) packages, select multiple, and export a JSON file you can import with `winget import --import-file`.

What’s included
---------------

- Static frontend (no build step): `index.html`, `src/app.js`, `src/style.css`.
- Local index dataset: `data/index.json`.
- Uses local index data (no external API required).

Running locally
---------------

Open `index.html` in a browser. For local file access, Chrome/Edge/Firefox work. If your browser blocks `fetch` of local files, serve the folder with a simple HTTP server, e.g.:

- Python: `python3 -m http.server 5500` then open `http://localhost:5500/`.

Backend (official repo index)
----------------------------

To fetch packages like winstall from the official Microsoft repository and serve them via API:

1) Install dependencies and start the server

```
npm install
npm start
```

2) On first run, build the index (this shallow-clones `microsoft/winget-pkgs` and parses manifests):

```
curl -X POST http://localhost:5173/api/sync
```

3) Note: the frontend demo uses the local `data/index.json` and does not call the API unless available. You can interact with the API separately for your own integrations.

Offline/local clone
-------------------

If your environment cannot access GitHub, you can build the index from a local clone placed at `data/winget-pkgs`:

```
git clone --depth 1 https://github.com/microsoft/winget-pkgs.git data/winget-pkgs
OFFLINE=1 npm run build:index
```

Or if the clone is already present, just run:

```
OFFLINE=1 npm run build:index
```

The server’s sync endpoint also respects `OFFLINE=1` and will skip any git operations.

API endpoints
-------------

- `GET /api/health` — readiness and counts.
- `POST /api/sync` — clone/update repo and rebuild index.
- `GET /api/list?offset=0&limit=50` — paginated list of packages.
- `GET /api/search?q=git&limit=50` — text search across name, id, publisher, tags, description.

Notes
-----

- The indexer scans `DefaultLocale*.yaml` manifests for common metadata. It avoids extra dependencies by using a simple, targeted parser for fields it needs (PackageIdentifier, PackageName, Publisher, Moniker, Tags, Description/ShortDescription, PackageVersion).
- Clone uses `--depth 1`. The winget repo is large; first-time sync can take a while depending on bandwidth.
- The server persists `data/index.json` and serves static files alongside the API.

Usage
-----

- Search: type keywords to filter packages.
- Add: click “Add” on results to build a selection.
- Export: click “Export winget import JSON” to download a file like `winget-web-20240101-1200.json` and use:
  `winget import --import-file "winget-web-20240101-1200.json"`
- Share: the URL encodes selected IDs (`?ids=Id1,Id2,...`).

API integration
---------------

The included server exposes endpoints you can use in your own tools or a customized frontend. The demo UI ships without API configuration and relies on the generated local index dataset.

winget import schema
--------------------

Exports use the modern schema with only identifiers:

```
{
  "$schema": "https://aka.ms/winget-packages.schema.2.0.json",
  "CreationDate": "<ISO8601>",
  "Sources": [
    {
      "SourceDetails": {
        "Name": "winget",
        "Argument": "https://cdn.winget.microsoft.com/cache",
        "Identifier": "Microsoft.Winget.Source_8wekyb3d8bbwe"
      },
      "Packages": [ { "PackageIdentifier": "Git.Git" }, ... ]
    }
  ]
}
```

Extending
---------

- Add pagination and filters (architecture, tags, publisher).
- Package details view pulling manifest metadata.
- Generate `winget install` scripts directly.
- Server that indexes the official winget manifests for fast search (out of scope here).
  - This repo now includes a simple indexer and API; consider switching to a proper YAML parser and adding a background scheduler for periodic updates.

License
-------

MIT
