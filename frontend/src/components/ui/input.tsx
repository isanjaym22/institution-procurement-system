import * as React from "react";
import { cn } from "../../lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900",
        "placeholder:text-zinc-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent",
        "disabled:cursor-not-allowed disabled:bg-zinc-50",
        className,
      )}
      {...props}
    />
  );
});
