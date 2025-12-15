import React from "react";

type AppShellProps = {
  sidebar: React.ReactNode;
  children: React.ReactNode;
};

export default function AppShell({ sidebar, children }: AppShellProps) {
  return (
    <div className="flex min-h-screen bg-gray-100">
      <aside className="w-64 bg-white border-r">{sidebar}</aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}

