import { PageShell } from "@/components/layout/page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

export default function CoachAnalyticsPage() {
  return (
    <PageShell
      title="Analytics"
      description="View detailed analytics and insights about your students"
    >
      <EmptyState
        title="Analytics Coming Soon"
        description="In the MVP, we will add comprehensive analytics including performance trends, activity patterns, and progress tracking."
        action={
          <Button variant="outline" disabled>
            Coming Soon
          </Button>
        }
        icon="📊"
      />
    </PageShell>
  );
}
