import React from "react";
import Link from "next/link";

type AppShellProps = {
  sidebar: React.ReactNode;
  children: React.ReactNode;
};

export default function AppShell({ sidebar, children }: AppShellProps) {
  return (
    <div className="flex min-h-screen bg-gray-100">
      <aside className="w-64 bg-white border-r">{sidebar}</aside>

      <div className="flex-1 flex flex-col">
        <header className="bg-white border-b px-6 py-3 flex items-center justify-between">
          <div className="font-semibold">RoboChess3</div>
          <nav className="flex gap-4 text-sm">
            <Link className="hover:underline" href="/">Home</Link>
            <Link className="hover:underline" href="/coach">Coach</Link>
            <Link className="hover:underline" href="/student">Student</Link>
            <Link className="hover:underline" href="/admin">Admin</Link>
          </nav>
        </header>

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
