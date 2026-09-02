// Auto-import file watcher using chokidar.
// Runs server-side only. Started from the server entry point.

import type { Db } from "@/db/index.server";

let watchers: Map<string, any> = new Map();
let chokidar: any = null;

async function getChokidar() {
  if (!chokidar) {
    const mod = await import("chokidar");
    chokidar = mod.default ?? mod;
  }
  return chokidar;
}

export async function startWatchers(db: Db) {
  try {
    const folders = await db.many<any>(
      "select * from public.import_watch_folders where enabled = true",
    );
    const chok = await getChokidar();
    for (const folder of folders) {
      if (watchers.has(folder.id)) continue;
      const pattern = folder.file_pattern || "*.mzXML";
      const watcher = chok.watch(folder.path, {
        ignored: /(^|[/\\])\./,
        persistent: true,
        ignoreInitial: true,
      });
      watcher.on("add", async (filePath: string) => {
        if (!filePath.toLowerCase().endsWith(".mzxml") && !filePath.toLowerCase().endsWith(".mzml")) return;
        await handleNewFile(db, folder, filePath);
      });
      watchers.set(folder.id, watcher);
      console.log(`[auto-import] Watching: ${folder.path} (${pattern})`);
    }
  } catch (e: any) {
    console.error("[auto-import] Failed to start watchers:", e?.message);
  }
}

export async function stopWatchers() {
  for (const [id, watcher] of watchers) {
    try { await watcher.close(); } catch {}
    watchers.delete(id);
  }
}

async function handleNewFile(db: Db, folder: any, filePath: string) {
  const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
  try {
    // Check if already imported
    const existing = await db.maybe<any>(
      "select * from public.imported_files where folder_id=$1 and file_path=$2",
      [folder.id, filePath],
    );
    if (existing) return;

    // Record as processing
    const record = await db.one<any>(
      `insert into public.imported_files (folder_id, file_path, file_name, status)
       values ($1, $2, $3, 'processing') returning *`,
      [folder.id, filePath, fileName],
    );

    // TODO: parse the mzXML file and create a run
    // For now, just mark as imported with a note
    await db.query(
      "update public.imported_files set status='imported' where id=$1",
      [record.id],
    );
    console.log(`[auto-import] Imported: ${fileName}`);
  } catch (e: any) {
    console.error(`[auto-import] Error importing ${fileName}:`, e?.message);
    try {
      await db.query(
        "update public.imported_files set status='failed', error_message=$1 where file_path=$2 and folder_id=$3",
        [e?.message ?? "unknown error", filePath, folder.id],
      );
    } catch {}
  }
}

export async function scanFolderNow(db: Db, folderId: string) {
  const folder = await db.maybe<any>(
    "select * from public.import_watch_folders where id=$1", [folderId],
  );
  if (!folder) throw new Error("Watch folder not found.");
  const fs = await import("fs/promises");
  const path = await import("path");
  try {
    const files = await fs.readdir(folder.path);
    let count = 0;
    for (const file of files) {
      const fullPath = path.join(folder.path, file);
      const stat = await fs.stat(fullPath);
      if (!stat.isFile()) continue;
      if (!file.toLowerCase().endsWith(".mzxml") && !file.toLowerCase().endsWith(".mzml")) continue;
      await handleNewFile(db, folder, fullPath);
      count++;
    }
    return { scanned: count };
  } catch (e: any) {
    throw new Error(`Scan failed: ${e?.message}`);
  }
}
