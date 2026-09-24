"use client";

import { useState } from "react";
import { Chat } from "@/components/Chat";
import { Sidebar } from "@/components/Sidebar";

export default function Home() {
  const [chatKey, setChatKey] = useState(0);

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Secondary Sidebar with Document Upload & List */}
      <Sidebar onClear={() => setChatKey((k) => k + 1)} />

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <div className="mx-auto w-full max-w-4xl px-4 py-5 flex-1 flex flex-col min-h-0">
          <Chat key={chatKey} />
        </div>
      </main>
    </div>
  );
}
