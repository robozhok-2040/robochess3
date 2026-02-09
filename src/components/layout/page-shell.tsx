import { cn } from "@/lib/cn";
import type { HTMLAttributes, ReactNode } from "react";

type PageShellProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
};

export function PageShell({ title, description, actions, children }: PageShellProps) {
  return (
    <div className="max-w-[1600px] mx-auto min-w-0 w-full">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-[hsl(var(--foreground))]">{title}</h1>
          {description && (
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {/* Content */}
      <div className="space-y-6">{children}</div>
    </div>
  );
}

type PageSectionProps = {
  title?: string;
  description?: string;
  right?: ReactNode;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>;

export function PageSection({ title, description, right, children, className, ...props }: PageSectionProps) {
  return (
    <div className={cn("space-y-4", className)} {...props}>
      {(title || right) && (
        <div className="flex items-start justify-between">
          {title && (
            <div>
              <h2 className="text-xl font-semibold text-[hsl(var(--foreground))]">{title}</h2>
              {description && (
                <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">{description}</p>
              )}
            </div>
          )}
          {right && <div>{right}</div>}
        </div>
      )}
      {children}
    </div>
  );
}





