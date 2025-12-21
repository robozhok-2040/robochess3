import { cn } from "@/lib/cn";
import type { HTMLAttributes } from "react";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: "default" | "success" | "warning" | "muted";
};

export function Badge({ variant = "default", className, ...props }: BadgeProps) {
  const variantClasses = {
    default: "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]",
    muted: "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
    success: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    warning: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        variantClasses[variant],
        className
      )}
      {...props}
    />
  );
}




