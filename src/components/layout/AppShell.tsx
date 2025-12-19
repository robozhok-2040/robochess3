"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";

type AppShellProps = {
  sidebar: React.ReactNode;
  children: React.ReactNode;
};

export default function AppShell({ sidebar, children }: AppShellProps) {
  const pathname = usePathname();

  const navLinks = [
    { href: "/", label: "Home" },
    { href: "/coach", label: "Coach" },
    { href: "/student", label: "Student" },
    { href: "/admin", label: "Admin" },
  ];

  const isActive = (href: string) => {
    if (href === "/") {
      return pathname === "/";
    }
    return pathname.startsWith(href);
  };

  return (
    <div className="min-h-screen bg-[hsl(var(--background))]">
      <div className="grid grid-rows-[56px,1fr] grid-cols-[auto,1fr] min-h-screen">
        <header className="col-span-2 row-start-1 h-14 border-b border-[hsl(var(--border))] bg-[hsl(var(--background))] px-6 flex items-center justify-between">
          <div className="font-semibold text-[hsl(var(--foreground))]">RoboChess3</div>
          <div className="flex items-center gap-4">
            <nav className="flex items-center gap-1">
              {navLinks.map((link) => {
                const active = isActive(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                      active
                        ? "text-[hsl(var(--foreground))] font-medium bg-[hsl(var(--muted))]"
                        : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>
            <ThemeToggle />
          </div>
        </header>

        <aside className="row-start-2 col-start-1 bg-[hsl(var(--card))] border-r border-[hsl(var(--border))]">
          {sidebar}
        </aside>

        <main className="row-start-2 col-start-2 min-w-0 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
