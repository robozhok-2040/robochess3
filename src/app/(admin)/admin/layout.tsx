import AppShell from "@/components/layout/AppShell";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell sidebar={<div className="p-4"><h2 className="font-semibold">Admin</h2></div>}>
      {children}
    </AppShell>
  );
}
