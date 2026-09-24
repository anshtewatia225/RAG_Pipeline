"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { query } from "@/lib/api";
import type { QueryResponse } from "@/lib/types";

interface Message {
  role: "user" | "assistant";
  content: string;
  data?: QueryResponse;
}

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const copyMessage = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const send = async () => {
    const q = input.trim();
    if (!q || loading) return;

    setMessages((m) => [...m, { role: "user", content: q }]);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const res = await query(q);
      setMessages((m) => [...m, { role: "assistant", content: res.answer, data: res }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Query failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-1 pb-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            {/* Empty State Icon */}
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, rgba(99,102,241,0.1), rgba(139,92,246,0.1))",
                border: "1px solid rgba(99,102,241,0.15)",
              }}
            >
              <svg className="w-7 h-7" style={{ color: "var(--accent-1)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                Ask a question about your documents
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
                Upload files in the sidebar, then start chatting
              </p>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} msg-enter`}
              style={{ animationDelay: `${i * 0.05}s` }}
            >
              <div className="flex items-start gap-2.5 max-w-[85%]">
                {/* Assistant avatar */}
                {m.role === "assistant" && (
                  <div
                    className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center mt-1"
                    style={{
                      background: "linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.15))",
                      border: "1px solid rgba(99,102,241,0.2)",
                    }}
                  >
                    <svg className="w-3.5 h-3.5" style={{ color: "var(--accent-1)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                )}

                <div
                  className={`${m.role === "user" ? "msg-user" : "msg-assistant"} px-4 py-3`}
                >
                  {m.role === "user" ? (
                    <p className="text-sm whitespace-pre-wrap leading-relaxed text-white">
                      {m.content}
                    </p>
                  ) : (
                    <div className="prose">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeRaw]}
                      >
                        {m.content}
                      </ReactMarkdown>
                    </div>
                  )}

                  {/* Sources */}
                  {m.data && m.data.sources.length > 0 && (
                    <details className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border-default)" }}>
                      <summary
                        className="cursor-pointer text-xs font-medium flex items-center gap-1.5 select-none transition-colors"
                        style={{ color: "var(--text-tertiary)" }}
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                        {m.data.sources.length} source{m.data.sources.length !== 1 ? "s" : ""}
                      </summary>
                      <ul className="mt-2.5 space-y-2">
                        {m.data.sources.map((s, j) => (
                          <li key={j} className="source-chip">
                            <p className="text-xs font-medium mb-1" style={{ color: "var(--accent-1)" }}>
                              {s.source}
                            </p>
                            <p className="text-xs leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
                              {s.text}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {/* Badges & Copy button */}
                  {m.role === "assistant" && (
                    <div className="mt-2.5 flex items-center justify-between gap-2 pt-1.5" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                      <div className="flex items-center gap-2">
                        {m.data && (
                          <>
                            <span className="badge">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              {m.data.total_latency_ms}ms
                            </span>
                            <span className="badge">
                              {m.data.chunks_retrieved} chunks
                            </span>
                          </>
                        )}
                      </div>
                      <button
                        onClick={() => copyMessage(m.content, i)}
                        className="text-xs flex items-center gap-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors py-0.5 px-1.5 rounded"
                        title="Copy answer"
                      >
                        {copiedIndex === i ? (
                          <>
                            <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                            <span className="text-[11px] text-green-400 font-medium">Copied</span>
                          </>
                        ) : (
                          <>
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            <span className="text-[11px]">Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Typing Indicator */}
          {loading && (
            <div className="flex justify-start msg-enter">
              <div className="flex items-start gap-2.5">
                <div
                  className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center"
                  style={{
                    background: "linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.15))",
                    border: "1px solid rgba(99,102,241,0.2)",
                  }}
                >
                  <svg className="w-3.5 h-3.5" style={{ color: "var(--accent-1)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div className="msg-assistant px-5 py-4">
                  <div className="flex gap-1.5">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div
            className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm mt-4 mx-auto max-w-md"
            style={{
              background: "rgba(239, 68, 68, 0.08)",
              border: "1px solid rgba(239, 68, 68, 0.2)",
              color: "#f87171",
            }}
          >
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="pt-3 pb-1" style={{ borderTop: "1px solid var(--border-default)" }}>
        <div className="flex items-center gap-2.5">
          <div className="flex-1 relative">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
              placeholder="Ask a question about your documents..."
              className="input-glass w-full pr-4"
              disabled={loading}
            />
          </div>
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            className="btn-primary shrink-0 flex items-center gap-1.5 !px-5 !py-3"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
