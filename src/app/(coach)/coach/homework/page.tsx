import { PageShell } from "@/components/layout/page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

export default function CoachHomeworkPage() {
  return (
    <PageShell
      title="Homework"
      description="Create and manage homework assignments for your students"
    >
      <EmptyState
        title="Homework Management Coming Soon"
        description="In the MVP, we will add features to create assignments, track completion, and review student work."
        action={
          <Button variant="outline" disabled>
            Coming Soon
          </Button>
        }
        icon="📝"
      />
    </PageShell>
  );
}

