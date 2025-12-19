import React from "react";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

type AppShellProps = {
  sidebar: React.ReactNode;
  children: React.ReactNode;
};

export default function AppShell({ sidebar, children }: AppShellProps) {
  return (
    <div className="flex min-h-screen bg-[hsl(var(--background))]">
      <aside className="w-64 bg-[hsl(var(--card))] border-r border-[hsl(var(--border))]">{sidebar}</aside>

      <div className="flex-1 flex flex-col">
        <header className="bg-[hsl(var(--card))] border-b border-[hsl(var(--border))] px-6 py-3 flex items-center justify-between">
          <div className="font-semibold text-[hsl(var(--foreground))]">RoboChess3</div>
          <div className="flex items-center gap-4">
            <nav className="flex gap-4 text-sm">
              <Link className="hover:underline text-[hsl(var(--foreground))]" href="/">Home</Link>
              <Link className="hover:underline text-[hsl(var(--foreground))]" href="/coach">Coach</Link>
              <Link className="hover:underline text-[hsl(var(--foreground))]" href="/student">Student</Link>
              <Link className="hover:underline text-[hsl(var(--foreground))]" href="/admin">Admin</Link>
            </nav>
            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
