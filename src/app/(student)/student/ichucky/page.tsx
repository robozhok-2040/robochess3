import { PageShell } from "@/components/layout/page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

export default function StudentIChuckyPage() {
  return (
    <PageShell
      title="iChucky"
      description="Interactive chess learning experience"
    >
      <EmptyState
        title="iChucky Coming Soon"
        description="In the MVP, we will add iChucky - an interactive learning module with guided lessons and interactive exercises."
        action={
          <Button variant="outline" disabled>
            Coming Soon
          </Button>
        }
        icon="🤖"
      />
    </PageShell>
  );
}
