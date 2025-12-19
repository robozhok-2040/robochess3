import AppShell from "@/components/layout/AppShell";
import Link from "next/link";

export default function CoachLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell
      sidebar={
        <nav className="p-4">
          <h2 className="font-semibold mb-4 text-sm uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            Coach
          </h2>
          <ul className="space-y-1">
            <li>
              <Link 
                className="block px-3 py-2 rounded-md text-sm text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors" 
                href="/coach"
              >
                Dashboard
              </Link>
            </li>
            <li>
              <Link 
                className="block px-3 py-2 rounded-md text-sm text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors" 
                href="/coach/analytics"
              >
                Analytics
              </Link>
            </li>
            <li>
              <Link 
                className="block px-3 py-2 rounded-md text-sm text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors" 
                href="/coach/students"
              >
                Students
              </Link>
            </li>
            <li>
              <Link 
                className="block px-3 py-2 rounded-md text-sm text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors" 
                href="/coach/homework"
              >
                Homework
              </Link>
            </li>
            <li>
              <Link 
                className="block px-3 py-2 rounded-md text-sm text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors" 
                href="/coach/mysite"
              >
                MySite
              </Link>
            </li>
          </ul>
        </nav>
      }
    >
      {children}
    </AppShell>
  );
}

