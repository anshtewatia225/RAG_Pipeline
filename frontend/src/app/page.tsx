"use client";

import { useEffect, useState } from "react";
import { Chat } from "@/components/Chat";
import { Sidebar } from "@/components/Sidebar";
import { deleteCollection, deleteConversation, getConversation } from "@/lib/api";
import type { ChatSession, IngestedFile, Message } from "@/lib/types";

const collectionFor = (chatId: string) => `chat_${chatId}`;

function makeChat(): ChatSession {
  return {
    id: crypto.randomUUID(),
    title: "New Conversation",
    messages: [],
    files: [],
    createdAt: Date.now(),
  };
}

export default function Home() {
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string>("");

  useEffect(() => {
    const saved = localStorage.getItem("rag_chats");
    // Client-only hydration: the static export renders before localStorage exists,
    // so this must run after mount rather than in a state initializer.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (saved) {
      try {
        const parsed: ChatSession[] = JSON.parse(saved);
        if (parsed.length > 0) {
          const normalized = parsed.map((chat) => ({
            ...chat,
            messages: (chat.messages || []).map((m) => ({
              ...m,
              id: m.id || crypto.randomUUID(),
            })),
          }));
          setChats(normalized);
          setActiveChatId(normalized[0].id);

          void (async () => {
            const seeded = await Promise.all(
              normalized.map(async (chat) => {
                if (chat.messages.length > 0) return chat;
                try {
                  const { messages } = await getConversation(chat.id);
                  if (messages.length > 0) {
                    return {
                      ...chat,
                      messages: messages.map((m) => ({
                        id: crypto.randomUUID(),
                        role: m.role,
                        content: m.content,
                        sources: m.sources || undefined,
                      })),
                    };
                  }
                } catch {
                  // server memory unavailable; keep local cache
                }
                return chat;
              })
            );
            setChats(seeded);
          })();
          return;
        }
      } catch (e) {
        console.error("Failed to load chats:", e);
      }
    }
    const fresh = makeChat();
    setChats([fresh]);
    setActiveChatId(fresh.id);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (chats.length > 0) {
      localStorage.setItem("rag_chats", JSON.stringify(chats));
    }
  }, [chats]);

  const createNewChat = () => {
    const newChat = makeChat();
    setChats((prev) => {
      const updated = [newChat, ...prev];
      localStorage.setItem("rag_chats", JSON.stringify(updated));
      return updated;
    });
    setActiveChatId(newChat.id);
  };

  const deleteChat = (id: string) => {
    const collection = collectionFor(id);
    void deleteCollection(collection).catch((e) =>
      console.error(`Failed to delete collection ${collection}:`, e)
    );
    void deleteConversation(id).catch((e) =>
      console.error(`Failed to delete conversation ${id}:`, e)
    );

    setChats((prev) => {
      const updated = prev.filter((c) => c.id !== id);
      if (updated.length === 0) {
        const fresh = makeChat();
        setActiveChatId(fresh.id);
        localStorage.setItem("rag_chats", JSON.stringify([fresh]));
        return [fresh];
      }
      if (activeChatId === id) {
        setActiveChatId(updated[0].id);
      }
      localStorage.setItem("rag_chats", JSON.stringify(updated));
      return updated;
    });
  };

  const updateActiveMessages = (messages: Message[]) => {
    setChats((prev) =>
      prev.map((chat) => {
        if (chat.id === activeChatId) {
          let title = chat.title;
          if (title === "New Conversation" && messages.length > 0) {
            const firstUserMsg = messages.find((m) => m.role === "user");
            if (firstUserMsg) {
              title =
                firstUserMsg.content.slice(0, 30) +
                (firstUserMsg.content.length > 30 ? "..." : "");
            }
          }
          return { ...chat, messages, title };
        }
        return chat;
      })
    );
  };

  const updateActiveFiles = (files: IngestedFile[]) => {
    setChats((prev) =>
      prev.map((chat) => (chat.id === activeChatId ? { ...chat, files } : chat))
    );
  };

  const activeChat = chats.find((c) => c.id === activeChatId) || chats[0];
  const collectionName = activeChat ? collectionFor(activeChat.id) : "rag_documents";

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[var(--bg-base)]">
      {/* Sleek Harmonized Header */}
      <header className="h-16 glass-panel border-b border-[var(--border-default)] px-6 flex items-center justify-between shrink-0 z-20 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center shadow-md"
            style={{
              background: "linear-gradient(135deg, rgba(99,102,241,0.25), rgba(139,92,246,0.25))",
              border: "1px solid rgba(99,102,241,0.4)",
            }}
          >
            <svg className="w-4 h-4 text-[var(--accent-1)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-wide text-white">
              RAG Pipeline Assistant
            </h1>
            <p className="text-[11px] text-[var(--text-tertiary)] font-medium">
              Enterprise Neural Retrieval & Generation
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            System Online
          </span>
        </div>
      </header>

      {/* Main App Layout */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          chats={chats}
          activeChatId={activeChatId}
          onSelectChat={setActiveChatId}
          onNewChat={createNewChat}
          onDeleteChat={deleteChat}
          files={activeChat ? activeChat.files : []}
          onFilesChange={updateActiveFiles}
          collectionName={collectionName}
        />
        <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden p-6">
          <div className="flex-1 max-w-5xl w-full mx-auto overflow-hidden flex flex-col">
            {activeChat && (
              <Chat
                key={activeChat.id}
                collectionName={collectionName}
                conversationId={activeChat.id}
                initialMessages={activeChat.messages}
                onMessagesChange={updateActiveMessages}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
