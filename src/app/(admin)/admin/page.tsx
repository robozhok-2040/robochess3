import { PageShell } from "@/components/layout/page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

export default function AdminPage() {
  return (
    <PageShell
      title="Admin"
      description="Administrative dashboard and system management"
    >
      <EmptyState
        title="Admin Panel Coming Soon"
        description="In the MVP, we will add administrative tools for user management, system configuration, and platform oversight."
        action={
          <Button variant="outline" disabled>
            Coming Soon
          </Button>
        }
        icon="⚙️"
      />
    </PageShell>
  );
}
