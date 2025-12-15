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
        <div className="p-4">
          <h2 className="font-semibold mb-2">Coach</h2>
          <ul className="space-y-1 text-sm">
            <li><Link className="hover:underline" href="/coach">Dashboard</Link></li>
            <li><Link className="hover:underline" href="/coach/analytics">Analytics</Link></li>
            <li><Link className="hover:underline" href="/coach/students">Students</Link></li>
            <li><Link className="hover:underline" href="/coach/homework">Homework</Link></li>
            <li><Link className="hover:underline" href="/coach/mysite">MySite</Link></li>
          </ul>
        </div>
      }
    >
      {children}
    </AppShell>
  );
}

