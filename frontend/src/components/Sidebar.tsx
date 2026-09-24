"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clearAll, deleteDocument, ingest } from "@/lib/api";

interface IngestedFile {
  name: string;
  chunks: number;
  collection: string;
  status: "ingesting" | "done" | "error";
  error?: string;
  progress?: number;
}

export function Sidebar({ onClear }: { onClear?: () => void }) {
  const [ingestedFiles, setIngestedFiles] = useState<IngestedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Clear backend vector store and state on initial mount / page refresh
  useEffect(() => {
    clearAll().catch((err) => console.error("Failed to clear on initial load:", err));
  }, []);

  const handleClearAll = async () => {
    try {
      await clearAll();
      setIngestedFiles([]);
      onClear?.();
    } catch (e) {
      console.error("Failed to clear documents:", e);
    }
  };

  const processFiles = useCallback(async (incoming: FileList | File[]) => {
    const arr = Array.from(incoming).filter(
      (f) => f.name.match(/\.(pdf|txt|md|py)$/i)
    );
    if (!arr.length) return;

    // Add files to list as "ingesting"
    const newEntries: IngestedFile[] = arr.map((f) => ({
      name: f.name,
      chunks: 0,
      collection: "",
      status: "ingesting" as const,
      progress: 0,
    }));

    setIngestedFiles((prev) => {
      // Remove duplicates by name
      const names = new Set(arr.map((f) => f.name));
      return [...prev.filter((f) => !names.has(f.name)), ...newEntries];
    });

    // Auto-ingest immediately
    try {
      const res = await ingest(arr, {}, (pct) => {
        setIngestedFiles((prev) =>
          prev.map((f) =>
            arr.some((a) => a.name === f.name) ? { ...f, progress: pct } : f
          )
        );
      });

      // Mark as done
      setIngestedFiles((prev) =>
        prev.map((f) =>
          arr.some((a) => a.name === f.name)
            ? {
                ...f,
                status: "done",
                chunks: Math.round(res.total_chunks / res.files_ingested.length),
                collection: res.collection,
                progress: 100,
              }
            : f
        )
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      setIngestedFiles((prev) =>
        prev.map((f) =>
          arr.some((a) => a.name === f.name)
            ? { ...f, status: "error", error: msg }
            : f
        )
      );
    }
  }, []);

  const removeFile = async (name: string) => {
    setIngestedFiles((prev) => prev.filter((f) => f.name !== name));
    try {
      await deleteDocument(name);
    } catch (e) {
      console.error(`Failed to delete document ${name}:`, e);
    }
  };

  const doneCount = ingestedFiles.filter((f) => f.status === "done").length;
  const totalChunks = ingestedFiles
    .filter((f) => f.status === "done")
    .reduce((sum, f) => sum + f.chunks, 0);

  return (
    <aside className="sidebar shrink-0">
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border-default)" }}>
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{
              background: "linear-gradient(135deg, rgba(99,102,241,0.12), rgba(139,92,246,0.12))",
            }}
          >
            <svg className="w-4 h-4" style={{ color: "var(--accent-1)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Documents
            </h2>
            {doneCount > 0 && (
              <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                {doneCount} file{doneCount !== 1 ? "s" : ""} · {totalChunks} chunks
              </p>
            )}
          </div>
        </div>

        {ingestedFiles.length > 0 && (
          <button
            onClick={handleClearAll}
            title="Clear all documents & reset database"
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors hover:bg-red-500/10 text-[var(--text-tertiary)] hover:text-red-400"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Clear
          </button>
        )}
      </div>

      {/* Drop Zone */}
      <div className="px-4 pt-4 pb-2">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            processFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={`upload-zone ${dragging ? "dragging" : ""}`}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.txt,.md,.py"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) processFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="flex justify-center mb-2">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-transform duration-300"
              style={{
                background: dragging ? "rgba(99, 102, 241, 0.15)" : "var(--bg-surface-hover)",
                transform: dragging ? "scale(1.1)" : "scale(1)",
              }}
            >
              <svg
                className="w-4 h-4 transition-colors"
                style={{ color: dragging ? "#6366f1" : "var(--text-tertiary)" }}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </div>
          </div>
          <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            Drop files or <span className="gradient-text font-semibold">browse</span>
          </p>
          <p className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
            PDF, TXT, MD, PY
          </p>
        </div>
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {ingestedFiles.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
              No documents uploaded yet
            </p>
          </div>
        ) : (
          <div className="space-y-1.5 mt-2">
            {ingestedFiles.map((file) => (
              <div
                key={file.name}
                className="group flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all duration-200"
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                {/* Status Icon */}
                <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0" style={{
                  background:
                    file.status === "done" ? "rgba(34, 197, 94, 0.1)" :
                    file.status === "error" ? "rgba(239, 68, 68, 0.1)" :
                    "rgba(99, 102, 241, 0.1)",
                }}>
                  {file.status === "ingesting" ? (
                    <svg className="w-3 h-3" style={{ color: "var(--accent-1)", animation: "spin-slow 1.5s linear infinite" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  ) : file.status === "done" ? (
                    <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-3 h-3 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                </div>

                {/* File Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>
                    {file.name}
                  </p>
                  <p className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                    {file.status === "ingesting"
                      ? `Processing${file.progress ? ` ${file.progress}%` : "..."}`
                      : file.status === "done"
                      ? `${file.chunks} chunks`
                      : file.error || "Failed"}
                  </p>
                  {/* Mini progress bar */}
                  {file.status === "ingesting" && (
                    <div className="progress-bar mt-1.5" style={{ height: "2px" }}>
                      <div className="progress-fill" style={{ width: `${file.progress || 5}%` }} />
                    </div>
                  )}
                </div>

                {/* Remove button */}
                <button
                  onClick={() => removeFile(file.name)}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded-lg transition-all hover:bg-red-500/10"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  <svg className="w-3 h-3 hover:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
