import AppShell from "@/components/layout/AppShell";
import Link from "next/link";

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell sidebar={
      <div className="p-4">
        <h2 className="font-semibold mb-2">Student</h2>
        <ul className="space-y-1 text-sm">
          <li><Link className="hover:underline" href="/student">Analytics</Link></li>
          <li><Link className="hover:underline" href="/student/puzzles">Puzzles</Link></li>
          <li><Link className="hover:underline" href="/student/visualization">Visualization</Link></li>
          <li><Link className="hover:underline" href="/student/ichucky">iChucky</Link></li>
          <li><Link className="hover:underline" href="/student/gamification">Gamification</Link></li>
        </ul>
      </div>
    }>
      {children}
    </AppShell>
  );
}
