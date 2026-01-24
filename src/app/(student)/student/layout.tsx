import AppShell from "@/components/layout/AppShell";
import { SidebarNav } from "@/components/layout/SidebarNav";

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  const navGroups = [
    {
      title: "",
      items: [
        { href: "/student", label: "Analytics", icon: "analytics" },
        { href: "/student/ichucky", label: "iChucky", icon: "dashboard" },
        { href: "/student/puzzles", label: "Puzzles", icon: "clipboard" },
      ],
    },
    {
      title: "Extras",
      items: [
        { href: "/student/visualization", label: "Visualization", icon: "analytics" },
        { href: "/student/gamification", label: "Gamification", icon: "users" },
      ],
    },
  ];

  return (
    <AppShell sidebar={<SidebarNav groups={navGroups} sectionTitle="STUDENT" />}>
      {children}
    </AppShell>
  );
}
