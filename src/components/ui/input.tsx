import { cn } from "@/lib/cn";
import type { InputHTMLAttributes } from "react";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full h-10 rounded-lg border border-[hsl(var(--border))]",
        "bg-[hsl(var(--background))] text-[hsl(var(--foreground))]",
        "placeholder:text-[hsl(var(--muted-foreground))]",
        "px-3 text-sm",
        "focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]",
        "focus:ring-offset-2 focus:ring-offset-[hsl(var(--background))]",
        "disabled:opacity-50 disabled:pointer-events-none",
        "transition-colors",
        className
      )}
      {...props}
    />
  );
}





