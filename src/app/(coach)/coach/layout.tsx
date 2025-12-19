import AppShell from "@/components/layout/AppShell";
import { SidebarNav } from "@/components/layout/SidebarNav";

export default function CoachLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const navGroups = [
    {
      title: "",
      items: [
        { href: "/coach", label: "Dashboard", icon: "dashboard" },
        { href: "/coach/analytics", label: "Analytics", icon: "analytics" },
      ],
    },
    {
      title: "Management",
      items: [
        { href: "/coach/students", label: "Students", icon: "users" },
        { href: "/coach/homework", label: "Homework", icon: "clipboard" },
        { href: "/coach/mysite", label: "MySite", icon: "link" },
      ],
    },
  ];

  return (
    <AppShell sidebar={<SidebarNav groups={navGroups} sectionTitle="COACH" />}>
      {children}
    </AppShell>
  );
}

