"use client";

import { useEffect, useState } from "react";
import { Chat } from "@/components/Chat";
import { Sidebar } from "@/components/Sidebar";
import type { ChatSession, IngestedFile, Message } from "@/lib/types";

export default function Home() {
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string>("");

  useEffect(() => {
    const saved = localStorage.getItem("rag_chats");
    if (saved) {
      try {
        const parsed: ChatSession[] = JSON.parse(saved);
        if (parsed.length > 0) {
          setChats(parsed);
          setActiveChatId(parsed[0].id);
          return;
        }
      } catch (e) {
        console.error("Failed to load chats:", e);
      }
    }
    createNewChat([]);
  }, []);

  useEffect(() => {
    if (chats.length > 0) {
      localStorage.setItem("rag_chats", JSON.stringify(chats));
    }
  }, [chats]);

  const createNewChat = (existingChats: ChatSession[] = chats) => {
    const newChat: ChatSession = {
      id: Date.now().toString(),
      title: "New Conversation",
      messages: [],
      files: [],
      createdAt: Date.now(),
    };
    const updated = [newChat, ...existingChats];
    setChats(updated);
    setActiveChatId(newChat.id);
    localStorage.setItem("rag_chats", JSON.stringify(updated));
  };

  const deleteChat = (id: string) => {
    const updated = chats.filter((c) => c.id !== id);
    if (updated.length === 0) {
      const fresh: ChatSession = {
        id: Date.now().toString(),
        title: "New Conversation",
        messages: [],
        files: [],
        createdAt: Date.now(),
      };
      setChats([fresh]);
      setActiveChatId(fresh.id);
      localStorage.setItem("rag_chats", JSON.stringify([fresh]));
    } else {
      setChats(updated);
      if (activeChatId === id) {
        setActiveChatId(updated[0].id);
      }
      localStorage.setItem("rag_chats", JSON.stringify(updated));
    }
  };

  const updateActiveMessages = (messages: Message[]) => {
    setChats((prev) =>
      prev.map((chat) => {
        if (chat.id === activeChatId) {
          let title = chat.title;
          if (title === "New Conversation" && messages.length > 0) {
            const firstUserMsg = messages.find((m) => m.role === "user");
            if (firstUserMsg) {
              title = firstUserMsg.content.slice(0, 30) + (firstUserMsg.content.length > 30 ? "..." : "");
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
  const collectionName = activeChat ? `chat_${activeChat.id}` : "rag_documents";

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
          onNewChat={() => createNewChat()}
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
                chatId={activeChat.id}
                collectionName={collectionName}
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
