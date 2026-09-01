import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "type-status inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border px-2 py-0.5 whitespace-nowrap",
  {
    defaultVariants: { variant: "default" },
    variants: {
      variant: {
        default: "border-transparent bg-primary-soft text-primary",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        success: "border-transparent bg-success-soft text-success",
        warning: "border-transparent bg-warning-soft text-warning",
        destructive: "border-transparent bg-destructive-soft text-destructive",
        outline: "border-border text-foreground",
      },
    },
  },
);

export function Badge({
  asChild = false,
  className,
  variant,
  ...props
}: ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { readonly asChild?: boolean }) {
  const Component = asChild ? Slot : "span";
  return (
    <Component
      className={cn(badgeVariants({ className, variant }))}
      data-slot="badge"
      {...props}
    />
  );
}
