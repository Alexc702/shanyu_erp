import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "type-form-control border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/30 min-h-24 w-full rounded-md border bg-transparent px-3 py-2 outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      data-slot="textarea"
      {...props}
    />
  );
}
