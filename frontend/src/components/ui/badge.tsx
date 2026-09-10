import * as React from "react";
import { cn } from "../../lib/utils";
import type { StatusTone } from "../../lib/workflow";

const tones: Record<StatusTone, string> = {
  neutral: "bg-zinc-100 text-zinc-700",
  info: "bg-accent/10 text-accent",
  success: "bg-emerald-50 text-success",
  danger: "bg-rose-50 text-danger",
  warning: "bg-amber-50 text-amber-700",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: StatusTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-lg px-2.5 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
