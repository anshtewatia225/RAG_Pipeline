"use client";

import Link from "next/link";
import { useTheme } from "./ThemeProvider";

export function Nav() {
  const { theme, toggle } = useTheme();

  return (
    <header className="nav-glow glass-strong sticky top-0 z-50">
      <div className="mx-auto max-w-[1400px] px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-indigo-500 to-violet-500 shadow-lg shadow-indigo-500/20 group-hover:shadow-indigo-500/40 transition-shadow">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-base font-bold tracking-tight gradient-text">RAG</span>
            <span className="text-base font-medium" style={{ color: "var(--text-tertiary)" }}>
              Pipeline
            </span>
          </div>
        </Link>

        {/* Right side */}
        <div className="flex items-center gap-1">
          <button
            onClick={toggle}
            className="p-2.5 rounded-xl transition-all duration-200 hover:bg-[var(--bg-surface-hover)] group"
            style={{ color: "var(--text-tertiary)" }}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? (
              <svg className="w-[18px] h-[18px] group-hover:text-amber-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg className="w-[18px] h-[18px] group-hover:text-indigo-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
