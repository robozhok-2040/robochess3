import { PageShell } from "@/components/layout/page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

export default function StudentPuzzlesPage() {
  return (
    <PageShell
      title="Puzzles"
      description="Practice with chess puzzles and improve your tactical skills"
    >
      <EmptyState
        title="Puzzles Coming Soon"
        description="In the MVP, we will add a puzzle solver with curated puzzles, difficulty levels, and progress tracking."
        action={
          <Button variant="outline" disabled>
            Coming Soon
          </Button>
        }
        icon="🧩"
      />
    </PageShell>
  );
}
