"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clearAll, deleteDocument, ingest } from "@/lib/api";
import type { ChatSession, IngestedFile } from "@/lib/types";

interface SidebarProps {
  chats: ChatSession[];
  activeChatId: string;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onDeleteChat: (id: string) => void;
  files?: IngestedFile[];
  onFilesChange: (files: IngestedFile[]) => void;
  collectionName: string;
}

export function Sidebar({
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  files = [],
  onFilesChange,
  collectionName,
}: SidebarProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<IngestedFile[]>(files);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const commitFiles = useCallback(
    (next: IngestedFile[]) => {
      filesRef.current = next;
      onFilesChange(next);
    },
    [onFilesChange]
  );

  const handleClearAll = async () => {
    try {
      await clearAll(collectionName);
      commitFiles([]);
    } catch (e) {
      console.error("Failed to clear documents:", e);
    }
  };

  const processFiles = useCallback(
    async (incoming: FileList | File[]) => {
      const arr = Array.from(incoming).filter((f) =>
        f.name.match(/\.(pdf|txt|md|py)$/i)
      );
      if (!arr.length) return;

      const names = new Set(arr.map((f) => f.name));
      const newEntries: IngestedFile[] = arr.map((f) => ({
        name: f.name,
        chunks: 0,
        collection: collectionName,
        status: "ingesting" as const,
        progress: 0,
      }));

      commitFiles([
        ...filesRef.current.filter((f) => !names.has(f.name)),
        ...newEntries,
      ]);

      try {
        const res = await ingest(arr, { collectionName }, (pct) => {
          commitFiles(
            filesRef.current.map((f) =>
              names.has(f.name) ? { ...f, progress: pct } : f
            )
          );
        });

        const chunkMap = new Map(res.files.map((f) => [f.name, f.chunks]));
        commitFiles(
          filesRef.current.map((f) =>
            names.has(f.name)
              ? {
                  ...f,
                  status: "done" as const,
                  chunks: chunkMap.get(f.name) ?? 0,
                  collection: res.collection,
                  progress: 100,
                }
              : f
          )
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed";
        commitFiles(
          filesRef.current.map((f) =>
            names.has(f.name)
              ? { ...f, status: "error" as const, error: msg }
              : f
          )
        );
      }
    },
    [collectionName, commitFiles]
  );

  const removeFile = async (name: string) => {
    commitFiles(filesRef.current.filter((f) => f.name !== name));
    try {
      await deleteDocument(name, collectionName);
    } catch (e) {
      console.error(`Failed to delete document ${name}:`, e);
    }
  };

  const doneCount = files.filter((f) => f.status === "done").length;

  return (
    <aside className="w-80 glass-panel shrink-0 flex flex-col h-full border-r border-[var(--border-default)] rounded-none">
      {/* New Chat Button */}
      <div className="p-4 border-b border-[var(--border-default)]">
        <button
          onClick={onNewChat}
          className="w-full btn-primary flex items-center justify-center gap-2 !py-2.5 text-xs font-medium"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          <span>New Chat</span>
        </button>
      </div>

      {/* Chat History Section */}
      <div className="px-4 py-3 border-b border-[var(--border-default)]">
        <p className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
          Conversations
        </p>
        <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
          {chats.map((chat) => {
            const isActive = chat.id === activeChatId;
            return (
              <div
                key={chat.id}
                onClick={() => onSelectChat(chat.id)}
                className={`group flex items-center justify-between px-3 py-2 rounded-xl text-xs cursor-pointer transition-all ${
                  isActive
                    ? "bg-[rgba(99,102,241,0.15)] border border-[var(--accent-1)] text-white font-medium"
                    : "hover:bg-white/5 text-[var(--text-secondary)] border border-transparent"
                }`}
              >
                <span className="truncate flex-1 mr-2">{chat.title}</span>
                {chats.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteChat(chat.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-[var(--text-tertiary)] hover:text-red-400 transition-opacity"
                    title="Delete chat"
                    aria-label={`Delete conversation ${chat.title}`}
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Document Archive Header */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-[var(--border-default)] bg-black/15">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-[var(--accent-1)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span className="text-xs font-semibold text-white">Linked Docs ({doneCount})</span>
        </div>
        {files.length > 0 && (
          <button
            onClick={handleClearAll}
            className="text-[11px] text-[var(--text-tertiary)] hover:text-red-400 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Drop Zone */}
      <div className="p-4">
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload documents"
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            processFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={`border border-dashed rounded-xl p-3 text-center cursor-pointer transition-all focus:outline-none focus:border-[var(--accent-1)] ${
            dragging
              ? "border-[var(--accent-1)] bg-[rgba(99,102,241,0.1)]"
              : "border-[var(--border-default)] bg-black/20 hover:border-[var(--accent-1)]"
          }`}
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
          <p className="text-xs font-medium text-white">Drop files for this chat</p>
          <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">PDF, TXT, MD, PY</p>
        </div>
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
        {files.map((file) => (
          <div
            key={file.name}
            className="p-2.5 rounded-xl bg-black/30 border border-[var(--border-subtle)] flex items-center justify-between group"
          >
            <div className="min-w-0 flex-1 mr-2">
              <p className="text-xs font-medium text-white truncate">{file.name}</p>
              <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                {file.status === "ingesting"
                  ? `Processing ${file.progress || 0}%`
                  : file.status === "error"
                  ? file.error || "Failed"
                  : `${file.chunks} chunks`}
              </p>
            </div>
            <button
              onClick={() => removeFile(file.name)}
              aria-label={`Remove ${file.name}`}
              className="text-[var(--text-tertiary)] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
