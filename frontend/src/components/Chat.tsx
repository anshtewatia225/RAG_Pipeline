"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import type { Message, Source } from "@/lib/types";
import { queryStream } from "@/lib/api";

interface ChatProps {
  collectionName: string;
  conversationId: string;
  initialMessages: Message[];
  onMessagesChange: (messages: Message[]) => void;
}

const SUGGESTED_QUERIES = [
  "Summarize the uploaded document",
  "What are the key technical takeaways?",
  "Explain the core architecture",
  "List key functions and endpoints",
];

export function Chat({ collectionName, conversationId, initialMessages, onMessagesChange }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages || []);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    onMessagesChange(messages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const updateMessages = (newMessages: Message[] | ((prev: Message[]) => Message[])) => {
    setMessages((prev) => (typeof newMessages === "function" ? newMessages(prev) : newMessages));
  };

  const copyMessage = (text: string, index: number) => {
    void navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const triggerSend = async (queryText: string) => {
    const q = queryText.trim();
    if (!q || loading) return;

    const nextMessages: Message[] = [
      ...messages,
      { id: crypto.randomUUID(), role: "user", content: q },
      { id: crypto.randomUUID(), role: "assistant", content: "" },
    ];
    updateMessages(nextMessages);
    setInput("");
    setLoading(true);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      let accumulatedContent = "";
      let currentSources: Source[] = [];

      for await (const evt of queryStream(q, {
        topK: 5,
        collectionName,
        conversationId,
        signal: controller.signal,
      })) {
        if (evt.type === "metadata") {
          currentSources = evt.sources;
        } else if (evt.type === "token") {
          accumulatedContent += evt.content;
          updateMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last?.role === "assistant") {
              copy[copy.length - 1] = {
                ...last,
                content: accumulatedContent,
                sources: currentSources,
              };
            }
            return copy;
          });
        } else if (evt.type === "error") {
          setError(evt.message);
          updateMessages((prev) => prev.slice(0, -1));
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Query failed");
      updateMessages((prev) => prev.slice(0, -1));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full flex-1 overflow-hidden">
      {/* Messages Area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto pr-3 space-y-6 pb-4"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full py-12 gap-5">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg"
              style={{
                background: "linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.2))",
                border: "1px solid rgba(99,102,241,0.3)",
              }}
            >
              <svg className="w-7 h-7 text-[var(--accent-1)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div className="text-center max-w-md">
              <p className="text-base font-semibold text-white">
                How can I help you with your documents?
              </p>
              <p className="text-xs text-[var(--text-tertiary)] mt-1.5 leading-relaxed">
                Upload files in the sidebar and ask questions to retrieve precise answers powered by neural retrieval.
              </p>
            </div>

            {/* 2x2 Grid of Suggested Queries */}
            <div className="grid grid-cols-2 gap-3.5 w-full max-w-xl mt-4">
              {SUGGESTED_QUERIES.map((query) => (
                <button
                  key={query}
                  onClick={() => triggerSend(query)}
                  className="text-left p-4 rounded-xl glass-panel hover:border-[var(--accent-1)] hover:bg-[rgba(99,102,241,0.08)] transition-all flex items-center justify-between group"
                  style={{ background: "rgba(255, 255, 255, 0.02)" }}
                >
                  <span className="text-xs font-medium text-[var(--text-secondary)] group-hover:text-white transition-colors">
                    {query}
                  </span>
                  <svg className="w-4 h-4 text-[var(--text-tertiary)] group-hover:text-[var(--accent-1)] transition-colors shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={m.id}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div className={`max-w-[85%] ${m.role === "user" ? "msg-user" : "msg-assistant"}`}>
              {m.role === "user" ? (
                <p className="text-sm whitespace-pre-wrap leading-relaxed text-white">
                  {m.content}
                </p>
              ) : (
                <div className="prose text-sm max-w-none">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeSanitize]}
                  >
                    {m.content}
                  </ReactMarkdown>
                  {loading && i === messages.length - 1 && !m.content && (
                    <div className="flex gap-1.5 py-1">
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                    </div>
                  )}
                </div>
              )}

              {m.role === "assistant" && m.content && (
                <button
                  onClick={() => copyMessage(m.content, i)}
                  aria-label="Copy answer"
                  className="mt-2 text-[10px] text-[var(--text-tertiary)] hover:text-white transition-colors"
                >
                  {copiedIndex === i ? "Copied" : "Copy"}
                </button>
              )}

              {/* Sources */}
              {m.sources && m.sources.length > 0 && (
                <details className="mt-4 pt-3 border-t border-[var(--border-default)]">
                  <summary className="cursor-pointer text-xs font-medium text-[var(--text-secondary)] hover:text-white transition-colors flex items-center gap-1.5 select-none">
                    <svg className="w-3.5 h-3.5 text-[var(--accent-1)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    {m.sources.length} Source{m.sources.length !== 1 ? "s" : ""} Retrieved
                  </summary>
                  <div className="mt-2.5 space-y-2">
                    {m.sources.map((s) => (
                      <div key={`${m.id}-${s.chunk_index}`} className="p-2.5 rounded-lg bg-black/20 border border-[var(--border-subtle)] text-xs">
                        <span className="font-semibold text-[var(--accent-1)]">
                          [{s.chunk_index}] {s.source}
                          {s.page != null ? ` \u00b7 p.${s.page + 1}` : ""}
                        </span>
                        <p className="text-[var(--text-secondary)] mt-1 leading-relaxed">{s.text}</p>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
          {error}
        </div>
      )}

      {/* Input Form */}
      <div className="pt-2">
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && triggerSend(input)}
            placeholder="Ask a question about your documents..."
            aria-label="Question"
            className="flex-1 glass-input text-sm"
            disabled={loading}
          />
          <button
            onClick={() => triggerSend(input)}
            disabled={!input.trim() || loading}
            className="btn-primary shrink-0 flex items-center gap-2"
          >
            <span>Send</span>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
