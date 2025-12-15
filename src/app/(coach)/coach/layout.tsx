import AppShell from "@/components/layout/AppShell";

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
            <li>Dashboard</li>
            <li>Students</li>
            <li>Homework</li>
          </ul>
        </div>
      }
    >
      {children}
    </AppShell>
  );
}

