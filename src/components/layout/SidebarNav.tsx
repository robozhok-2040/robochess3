"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";

type NavItem = {
  href: string;
  label: string;
  icon: string | React.ReactNode;
};

type NavGroup = {
  title: string;
  items: NavItem[];
};

type SidebarNavProps = {
  groups: NavGroup[];
  sectionTitle: string;
};

// Simple inline SVG icons (minimal, no external libs)
const DashboardIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
  </svg>
);

const AnalyticsIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
);

const UsersIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
  </svg>
);

const ClipboardIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
  </svg>
);

const LinkIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
  </svg>
);

const ChevronLeftIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);

// Icon mapping helper function
function getIcon(iconKey: string): React.ReactNode {
  const iconMap: Record<string, React.ReactNode> = {
    dashboard: <DashboardIcon />,
    analytics: <AnalyticsIcon />,
    users: <UsersIcon />,
    clipboard: <ClipboardIcon />,
    link: <LinkIcon />,
  };
  return iconMap[iconKey] || <DashboardIcon />;
}

export function SidebarNav({ groups, sectionTitle }: SidebarNavProps) {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(true); // Default to collapsed

  // Load collapsed state from localStorage (client-safe)
  useEffect(() => {
    const saved = localStorage.getItem("sidebar-collapsed");
    if (saved !== null) {
      setIsCollapsed(saved === "true");
    }
    // If no saved value, keep default (collapsed = true)
  }, []);

  // Save collapsed state to localStorage
  const toggleCollapse = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    localStorage.setItem("sidebar-collapsed", String(newState));
  };

  const isActive = (href: string) => {
    if (href === "/coach") {
      return pathname === "/coach";
    }
    return pathname.startsWith(href);
  };

  return (
    <div className={`flex flex-col sticky top-14 self-start h-[calc(100vh-56px)] ${isCollapsed ? "w-16" : "w-40"} transition-all duration-200 bg-[hsl(var(--card))]`}>
      <div className="flex-1 overflow-y-auto p-3">
        {/* Section Title */}
        {!isCollapsed && (
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-4 px-2">
            {sectionTitle}
          </h2>
        )}

        {/* Navigation Groups */}
        <nav className="space-y-6">
          {groups.map((group, groupIdx) => (
            <div key={groupIdx}>
              {/* Group Heading */}
              {!isCollapsed && group.title && (
                <h3 className="text-xs uppercase tracking-widest text-[hsl(var(--muted-foreground))] px-2 mt-4 mb-2">
                  {group.title}
                </h3>
              )}

              {/* Group Items */}
              <ul className="space-y-1">
                {group.items.map((item) => {
                  const active = isActive(item.href);
                  const icon = typeof item.icon === "string" ? getIcon(item.icon) : item.icon;
                  
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`flex items-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors ${
                          active
                            ? "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] font-medium"
                            : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
                        }`}
                        title={isCollapsed ? item.label : undefined}
                      >
                        <span className="flex-shrink-0">
                          {icon || <DashboardIcon />}
                        </span>
                        {!isCollapsed && <span>{item.label}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      {/* Collapse Toggle Button - Compact */}
      <div className="px-2 pb-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleCollapse}
          className={`w-full gap-2 h-8 px-2 ${isCollapsed ? "justify-center" : "justify-start"}`}
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <span className="flex-shrink-0">
            {isCollapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
          </span>
          {!isCollapsed && <span className="text-xs">Collapse</span>}
        </Button>
      </div>
    </div>
  );
}

