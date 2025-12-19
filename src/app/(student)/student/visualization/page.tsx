import { PageShell } from "@/components/layout/page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

export default function StudentVisualizationPage() {
  return (
    <PageShell
      title="Visualization"
      description="Visualize your games and analyze positions"
    >
      <EmptyState
        title="Visualization Coming Soon"
        description="In the MVP, we will add visualization tools to analyze your games, review key positions, and understand strategic patterns."
        action={
          <Button variant="outline" disabled>
            Coming Soon
          </Button>
        }
        icon="🎨"
      />
    </PageShell>
  );
}

