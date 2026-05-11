import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto max-w-7xl px-5 py-12 md:px-8" aria-busy>
      <div className="space-y-3">
        <Skeleton className="skeleton-stagger h-9 w-48 rounded-full" />
        <Skeleton
          className="skeleton-stagger h-4 w-2/3 max-w-xl rounded-full"
          style={{ animationDelay: "60ms" }}
        />
      </div>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div
            key={index}
            className="studio-card skeleton-stagger flex flex-col rounded-[1.6rem] p-4"
            style={{ animationDelay: `${120 + index * 60}ms` }}
          >
            <Skeleton className="aspect-[3/4] w-full rounded-[1.25rem]" />
            <div className="mt-3 space-y-2">
              <Skeleton className="h-3 w-1/3 rounded-full" />
              <Skeleton className="h-3 w-full rounded-full" />
              <Skeleton className="h-3 w-4/5 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
