import { PageShell } from "@/components/layout/page-shell";
import IchuckyCard from "./IchuckyCard";

export default function StudentPage() {
  return (
    <PageShell
      title="Analytics"
      description="View your progress and performance analytics"
    >
      <div className="grid gap-6">
        <div className="text-lg font-semibold text-[hsl(var(--foreground))]">
          Student Home v0.1
        </div>
        <IchuckyCard />
      </div>
    </PageShell>
  );
}
