import { cn } from "@/lib/utils";

type SkeletonProps = React.HTMLAttributes<HTMLDivElement> & {
  delay?: number;
};

export function Skeleton({ className, delay, style, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn("skeleton-shimmer rounded-md", className)}
      style={
        delay != null
          ? { ...style, animationDelay: `${delay}ms` }
          : style
      }
      {...props}
    />
  );
}
