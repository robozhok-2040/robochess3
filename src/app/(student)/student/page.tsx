import { PageShell } from "@/components/layout/page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

export default function StudentPage() {
  return (
    <PageShell
      title="Analytics"
      description="View your progress and performance analytics"
    >
      <EmptyState
        title="Analytics Coming Soon"
        description="In the MVP, we will add personalized analytics showing your progress, strengths, and areas for improvement."
        action={
          <Button variant="outline" disabled>
            Coming Soon
          </Button>
        }
        icon="📈"
      />
    </PageShell>
  );
}
