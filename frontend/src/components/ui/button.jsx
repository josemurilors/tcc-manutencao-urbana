import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: "bg-[var(--color-gold-500)] text-[var(--color-on-primary)] font-semibold hover:bg-[var(--color-gold-400)] shadow-sm",
        secondary: "bg-transparent border border-[var(--color-gold-500)] text-[var(--color-gold-text)] hover:bg-[rgba(212,160,23,0.1)]",
        ghost: "bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)]",
        danger: "bg-[var(--color-error)] text-white hover:brightness-90",
      },
      size: {
        default: "h-9 gap-1.5 px-4 py-2",
        xs: "h-6 gap-1 rounded-sm px-2 text-xs",
        sm: "h-7 gap-1 px-2.5 text-xs",
        lg: "h-10 gap-1.5 px-6 text-base",
        icon: "size-9",
        "icon-sm": "size-7",
        "icon-xs": "size-6",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "primary",
  size = "default",
  ...props
}) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props} />
  );
}

export { Button }
