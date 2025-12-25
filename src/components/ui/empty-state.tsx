import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
};

export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12 px-6 text-center">
        {icon && <div className="mb-4 text-4xl">{icon}</div>}
        <h3 className="text-lg font-semibold text-[hsl(var(--foreground))] mb-2">{title}</h3>
        {description && (
          <p className="text-sm text-[hsl(var(--muted-foreground))] max-w-md mb-6">
            {description}
          </p>
        )}
        {action && <div>{action}</div>}
      </CardContent>
    </Card>
  );
}





