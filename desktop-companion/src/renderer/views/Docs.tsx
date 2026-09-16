import { useMemo, useState } from "react";
import { cn, Icons } from "../components/ui";

// ─── Content model ────────────────────────────────────────────────────────────
type Block =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "list"; items: string[] }
  | { type: "code"; text: string }
  | { type: "callout"; variant: "info" | "tip" | "warn"; title: string; text: string }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "steps"; items: { title: string; text: string }[] };

type Section = { id: string; title: string; icon: keyof typeof Icons; blocks: Block[] };

const SECTIONS: Section[] = [
  {
    id: "getting-started",
    title: "Getting started",
    icon: "dashboard",
    blocks: [
      { type: "p", text: "V3 Companion watches local folders for new .mzXML and .mzML files, parses them on your machine, and uploads the results to your ChromaFlow web application — no manual uploads required." },
      { type: "h2", text: "First-run checklist" },
      {
        type: "steps",
        items: [
          { title: "Connect", text: "Open Settings, enter your ChromaFlow URL (e.g. https://your-instance.example.com) and sign in with your ChromaFlow credentials." },
          { title: "Add a watch directory", text: "Go to Watch Directories → Add directory and pick the folder your instrument software writes to." },
          { title: "Choose defaults", text: "Optionally assign a method, column, batch and compound list so every file from that folder lands pre-tagged." },
          { title: "Drop a file", text: "Copy an .mzXML or .mzML file into the watched folder. It appears in the Queue within seconds." },
        ],
      },
      { type: "callout", variant: "tip", title: "Runs everywhere", text: "The companion minimizes to the system tray and keeps watching even when the window is closed." },
    ],
  },
  {
    id: "connection",
    title: "Connecting to ChromaFlow",
    icon: "settings",
    blocks: [
      { type: "p", text: "The companion talks to ChromaFlow over a small REST API. You need the base URL of your deployment and an account with upload permissions." },
      { type: "h2", text: "Settings → Connection" },
      {
        type: "table",
        header: ["Field", "Description", "Example"],
        rows: [
          ["API endpoint", "Base URL of the ChromaFlow web app — no trailing path needed", "https://lab.example.com"],
          ["Email / password", "Your ChromaFlow sign-in", "you@lab.org"],
          ["Stay logged in", "Persists the session token between restarts", "On"],
        ],
      },
      { type: "p", text: "Use Test connection to verify reachability and credentials before saving. A green status dot in the status bar means the app is authenticated and watching." },
      { type: "callout", variant: "warn", title: "HTTPS recommended", text: "Credentials and raw files travel over this connection — use TLS in production." },
    ],
  },
  {
    id: "watch-directories",
    title: "Watch directories",
    icon: "folders",
    blocks: [
      { type: "p", text: "Each watch directory is scanned for new .mzXML and .mzML files — including files that already exist when the watcher starts." },
      { type: "h2", text: "Per-directory options" },
      {
        type: "table",
        header: ["Option", "What it does"],
        rows: [
          ["Recursive", "Also watches all subdirectories of the chosen folder"],
          ["File pattern", "Optional filename filter (e.g. *sample*). Leave empty to accept all .mzXML/.mzML files"],
          ["Stabilization", "Seconds a file must remain unchanged before it's processed — prevents uploading a file still being written"],
          ["Archive behavior", "After a successful upload: leave the file in place, move it to an archive folder, or delete it"],
          ["Max retries", "How many times a failed upload is retried before being marked failed"],
          ["Assignments", "Default method / column / batch / compound list applied to every file from this folder"],
        ],
      },
      { type: "callout", variant: "info", title: "No column selected?", text: "That's fine — the run is still created and you can assign a column later in the ChromaFlow web portal." },
      { type: "h2", text: "Enable / disable" },
      { type: "p", text: "Toggle a directory off to pause watching it without deleting its configuration. Disabled folders are dimmed in the list." },
    ],
  },
  {
    id: "queue",
    title: "Upload queue",
    icon: "queue",
    blocks: [
      { type: "p", text: "Every detected file enters the queue. The queue is persisted on disk, so pending items survive restarts." },
      { type: "h2", text: "Status lifecycle" },
      {
        type: "steps",
        items: [
          { title: "Queued / Needs metadata", text: "Waiting for upload — or waiting for you to assign metadata when the folder requires per-file assignment." },
          { title: "Parsing", text: "The file is being parsed locally in a worker thread (scans, peaks, metadata)." },
          { title: "Uploading", text: "Raw file, scan blob and parsed data are sent to ChromaFlow in chunks." },
          { title: "Done", text: "The run now exists in ChromaFlow and is visible on the Runs page." },
          { title: "Failed / Cancelled", text: "Something went wrong — check the Output panel, then retry." },
        ],
      },
      { type: "h2", text: "Controls" },
      {
        type: "list",
        items: [
          "Pause All / Resume All — freezes the watcher and the queue together (toolbar or Watcher menu).",
          "Retry — re-attempts a failed upload without re-detecting the file.",
          "Remove — drops an item from the queue without uploading.",
          "Clear — removes all queued or completed items.",
        ],
      },
    ],
  },
  {
    id: "assignment",
    title: "Metadata assignment",
    icon: "layers",
    blocks: [
      { type: "p", text: "Runs can be tagged with a method, column, batch and compound list so they arrive in ChromaFlow fully organized and auto-annotated." },
      { type: "h2", text: "Two modes" },
      {
        type: "table",
        header: ["Mode", "Behavior"],
        rows: [
          ["Per-folder", "Every file inherits its watch directory's assignments (Settings → Assignment mode)."],
          ["Per-file", "Each file pauses in \"Needs metadata\" until you pick assignments in the assign dialog."],
        ],
      },
      { type: "p", text: "Method, column, batch and compound-list choices are fetched live from the ChromaFlow database — the lists always reflect what exists in the web app." },
      { type: "callout", variant: "tip", title: "Compound lists", text: "Assigning a compound list makes ChromaFlow auto-annotate detected peaks against that list as soon as the run lands." },
    ],
  },
  {
    id: "history",
    title: "Upload history",
    icon: "history",
    blocks: [
      { type: "p", text: "Upload History records every processed file with its source folder, size, duration, status and SHA-256 checksum." },
      {
        type: "list",
        items: [
          "Resize columns — drag the edge between two column headers to widen or narrow them. Use \"Reset widths\" to restore defaults.",
          "Search filters the current page by filename.",
          "Export CSV downloads the full history for audits.",
          "SHA-256 — hover a checksum and click the copy icon to grab the full hash.",
          "Reupload resends a file (useful after fixing metadata).",
          "Delete removes selected history rows — it does not delete runs in ChromaFlow.",
        ],
      },
    ],
  },
  {
    id: "settings",
    title: "Settings reference",
    icon: "settings",
    blocks: [
      {
        type: "table",
        header: ["Setting", "Description"],
        rows: [
          ["API endpoint", "Base URL of the ChromaFlow deployment"],
          ["Max concurrent uploads", "How many files upload in parallel (default 2)"],
          ["Stabilization (default)", "Fallback settle time for new watch directories"],
          ["Max retries (default)", "Fallback retry budget for new watch directories"],
          ["Assignment mode", "Per-folder or per-file metadata assignment"],
          ["Notifications", "Windows toast notifications for upload events"],
          ["Minimize to tray", "Closing the window hides it to the system tray instead of quitting"],
          ["Start with Windows", "Launches the companion at sign-in"],
          ["Log level", "Verbosity of the Output panel (INFO / WARN / ERROR / DEBUG)"],
          ["Forget processed on delete", "If off, a file that was already uploaded is not re-processed when re-detected"],
        ],
      },
    ],
  },
  {
    id: "tray",
    title: "Tray & notifications",
    icon: "bell",
    blocks: [
      { type: "p", text: "The companion lives in the Windows system tray. Right-click the tray icon for quick actions." },
      {
        type: "list",
        items: [
          "Show / Hide window",
          "Pause All / Resume All watching and uploads",
          "Jump to Dashboard, Queue or Settings",
          "Quit the app entirely",
        ],
      },
      { type: "p", text: "Toast notifications fire on upload success, failure, and when a file needs metadata assignment." },
    ],
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    icon: "xCircle",
    blocks: [
      {
        type: "table",
        header: ["Symptom", "Likely cause", "Fix"],
        rows: [
          ["Files not detected", "Folder disabled, wrong path, or file still being written", "Check Watch Directories; raise stabilization time"],
          ["\"Needs metadata\" forever", "Per-file assignment mode is on", "Assign in the Queue view, or switch to per-folder mode"],
          ["Uploads fail with 401/403", "Token expired or insufficient permissions", "Sign in again in Settings"],
          ["Runs not visible in portal", "Create-run call failed after upload", "Check Output panel; retry from Queue or History"],
          ["\"Connection refused\"", "Wrong endpoint or server down", "Test connection in Settings; verify URL and VPN"],
          ["Duplicate uploads", "File re-detected after being moved/copied", "Enable \"Forget processed on delete\" or adjust archive behavior"],
        ],
      },
      { type: "callout", variant: "info", title: "The Output panel", text: "The collapsible panel at the bottom of every view shows a live log. Set log level to DEBUG in Settings for maximum detail." },
    ],
  },
];

// ─── Block renderers ──────────────────────────────────────────────────────────
function Callout({ variant, title, text }: { variant: "info" | "tip" | "warn"; title: string; text: string }) {
  const styles = {
    info: { box: "bg-[#EBF1FE] border-[#BFCFFB]", icon: "text-[#2563EB]", title: "text-[#1D4ED8]" },
    tip:  { box: "bg-[#ECFDF3] border-[#BBF7D0]", icon: "text-[#16A34A]", title: "text-[#15803D]" },
    warn: { box: "bg-[#FFFBEB] border-[#FDE68A]", icon: "text-[#D97706]", title: "text-[#B45309]" },
  }[variant];
  return (
    <div className={cn("border px-3.5 py-3 my-3", styles.box)} style={{ borderRadius: 2 }}>
      <div className={cn("flex items-center gap-2 text-[11px] font-semibold mb-1", styles.title)}>
        <span className={styles.icon}>{variant === "warn" ? "⚠" : variant === "tip" ? "💡" : "ℹ"}</span>
        {title}
      </div>
      <p className="text-[12px] text-[#374151] leading-relaxed">{text}</p>
    </div>
  );
}

function BlockRenderer({ block }: { block: Block }) {
  switch (block.type) {
    case "p":
      return <p className="text-[13px] text-[#374151] leading-relaxed my-3">{block.text}</p>;
    case "h2":
      return (
        <h2 className="text-[15px] font-semibold text-[#111827] mt-7 mb-2 pb-2 border-b border-[#E5E7EB]">{block.text}</h2>
      );
    case "h3":
      return <h3 className="text-[13px] font-semibold text-[#111827] mt-5 mb-1.5">{block.text}</h3>;
    case "list":
      return (
        <ul className="my-3 flex flex-col gap-1.5">
          {block.items.map((it, i) => (
            <li key={i} className="flex gap-2 text-[13px] text-[#374151] leading-relaxed">
              <span className="text-[#2563EB] shrink-0 mt-0.5">▪</span>
              <span>{it}</span>
            </li>
          ))}
        </ul>
      );
    case "code":
      return (
        <pre className="my-3 bg-[#111827] text-[#E5E7EB] text-[11px] font-mono px-3.5 py-3 overflow-x-auto" style={{ borderRadius: 2 }}>
          {block.text}
        </pre>
      );
    case "callout":
      return <Callout {...block} />;
    case "steps":
      return (
        <ol className="my-3 flex flex-col gap-2.5">
          {block.items.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="w-5 h-5 shrink-0 flex items-center justify-center bg-[#2563EB] text-white text-[10px] font-bold mt-0.5" style={{ borderRadius: 2 }}>
                {i + 1}
              </span>
              <div>
                <div className="text-[13px] font-semibold text-[#111827]">{s.title}</div>
                <div className="text-[12px] text-[#4B5563] leading-relaxed">{s.text}</div>
              </div>
            </li>
          ))}
        </ol>
      );
    case "table":
      return (
        <div className="my-3 border border-[#E5E7EB] overflow-hidden" style={{ borderRadius: 2 }}>
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[#F9FAFB]">
                {block.header.map((h) => (
                  <th key={h} className="text-left text-[10px] font-semibold uppercase tracking-wider text-[#6B7280] px-3 py-2 border-b border-[#E5E7EB]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((r, i) => (
                <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-[#F9FAFB]"}>
                  {r.map((cell, j) => (
                    <td key={j} className={cn("px-3 py-2 text-[12px] leading-relaxed border-b border-[#F3F4F6] align-top", j === 0 ? "font-semibold text-[#111827] whitespace-nowrap" : "text-[#4B5563]")}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return null;
  }
}

// ─── Documentation view ───────────────────────────────────────────────────────
export function Docs() {
  const [activeId, setActiveId] = useState(SECTIONS[0].id);
  const [query, setQuery] = useState("");
  const active = SECTIONS.find((s) => s.id === activeId) ?? SECTIONS[0];

  const filtered = useMemo(
    () => (query ? SECTIONS.filter((s) => s.title.toLowerCase().includes(query.toLowerCase())) : SECTIONS),
    [query],
  );

  return (
    <div className="flex h-full bg-white min-h-0">
      {/* Section nav */}
      <div className="flex flex-col w-52 shrink-0 border-r border-[#E5E7EB] bg-[#F9FAFB]">
        <div className="px-3 py-2.5 border-b border-[#E5E7EB]">
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[#9CA3AF]">{Icons.search}</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter topics…"
              className="w-full pl-6 pr-2 py-1 text-[11px] bg-white border border-[#D1D5DB] text-[#111827] placeholder-[#9CA3AF] outline-none focus:border-[#2563EB]"
              style={{ borderRadius: 2 }}
            />
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto py-1">
          {filtered.map((s) => {
            const isActive = s.id === activeId;
            return (
              <button
                key={s.id}
                onClick={() => setActiveId(s.id)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 h-9 text-[12px] text-left transition-colors relative",
                  isActive ? "bg-[#EBF1FE] text-[#2563EB] font-semibold" : "text-[#374151] hover:bg-[#F3F4F6] font-medium"
                )}
              >
                {isActive && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#2563EB]" />}
                <span className={isActive ? "text-[#2563EB]" : "text-[#9CA3AF]"}>{Icons[s.icon]}</span>
                {s.title}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="px-3 py-4 text-[11px] text-[#9CA3AF]">No matching topics</div>
          )}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-[760px] px-8 py-6">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-[#9CA3AF] mb-1">Documentation</div>
          <h1 className="text-[22px] font-bold text-[#111827] tracking-tight mb-4 pb-4 border-b-2 border-[#2563EB] w-fit">{active.title}</h1>
          {active.blocks.map((b, i) => <BlockRenderer key={i} block={b} />)}
          <div className="mt-8 pt-4 border-t border-[#E5E7EB] flex items-center justify-between">
            <span className="text-[10px] text-[#9CA3AF]">V3 Companion · bundled docs — no internet required</span>
            <div className="flex gap-1">
              {(() => {
                const idx = SECTIONS.findIndex((s) => s.id === active.id);
                const prev = SECTIONS[idx - 1];
                const next = SECTIONS[idx + 1];
                return (
                  <>
                    {prev && (
                      <button onClick={() => setActiveId(prev.id)} className="px-3 py-1.5 text-[11px] font-medium text-[#374151] border border-[#D1D5DB] hover:bg-[#F9FAFB] transition-colors" style={{ borderRadius: 2 }}>
                        ← {prev.title}
                      </button>
                    )}
                    {next && (
                      <button onClick={() => setActiveId(next.id)} className="px-3 py-1.5 text-[11px] font-medium text-white bg-[#2563EB] hover:bg-[#1D4ED8] transition-colors" style={{ borderRadius: 2 }}>
                        {next.title} →
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
