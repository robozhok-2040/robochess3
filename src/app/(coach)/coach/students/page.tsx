import { PageShell } from "@/components/layout/page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function CoachStudentsPage() {
  return (
    <PageShell
      title="Students"
      description="Manage and view all your students"
    >
      <EmptyState
        title="Students Management"
        description="View and manage all students from the main Dashboard. Advanced student management features will be added here in the future."
        action={
          <Link href="/coach">
            <Button variant="outline">Go to Dashboard</Button>
          </Link>
        }
        icon="👥"
      />
    </PageShell>
  );
}

