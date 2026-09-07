# Desktop Companion — V3 ChromaFlow

Windows Electron desktop application that watches local directories for `.mzXML` and `.mzML` files, parses them locally, and uploads to the ChromaFlow V3 web application.

## Architecture

- **Electron** main process + React renderer
- **Vite** for renderer bundling
- **Tailwind CSS v4** for styling
- **TypeScript** throughout
- **Chokidar** for filesystem watching
- **better-sqlite3** for local persistence (queue, history, logs, settings)
- **Worker threads** for mzXML/mzML parsing (ported from the V3 browser worker)
- **electron-store** for settings persistence
- **electron-updater** for auto-updates
- **electron-builder** with NSIS for Windows packaging

## Build commands

```bash
# Install dependencies (requires Windows Build Tools for better-sqlite3)
npm install

# Dev mode (Vite dev server + Electron)
npm run dev

# Build renderer + main process
npm run build

# Package as NSIS installer
npm run pack

# Run tests
npm test
```

## Project structure

- `src/main/` — Electron main process (window, tray, IPC, watcher, queue, parser)
- `src/preload/` — Preload script (contextBridge API)
- `src/renderer/` — React renderer (UI components, views, hooks)
- `src/shared/` — Shared IPC types
- `resources/` — Icons and assets
- `tests/` — Unit tests

## V3 REST API endpoints

The desktop app communicates with V3 via these endpoints:

- `GET /api/desktop/health` — Health check (no auth)
- `POST /api/desktop/login` — Login, returns JWT
- `POST /api/desktop/upload-url` — Get signed upload URL
- `POST /api/desktop/create-run` — Create a run with peaks
- `POST /api/desktop/find-run` — Find run by file path (dedup)
- `GET /api/desktop/watch-folders` — List watch folders
- `POST /api/desktop/watch-folders` — Upsert watch folder
- `DELETE /api/desktop/watch-folders/:id` — Delete watch folder
- `GET /api/desktop/lab-data` — Get methods, columns, batches, compound lists

All authenticated endpoints require `Authorization: Bearer <token>` header.

## Docker

The V3 Docker image is built as:
- `ddlidded/chroma-lab:v4` — versioned tag
- `ddlidded/chroma-lab:latest` — latest tag

Rollback: deploy `ddlidded/chroma-lab:v3`.
