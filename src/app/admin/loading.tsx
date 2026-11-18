import { Skeleton } from "@/components/ui/skeleton";

export default function AdminLoading() {
  return (
    <main className="pb-16" aria-busy="true" aria-live="polite">
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-7 md:px-8">
        <div className="flex flex-col gap-3 border-b border-[var(--admin-line)] pb-5">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-9 w-56 rounded-xl" delay={40} />
          <Skeleton className="h-4 w-96 max-w-full rounded-md" delay={80} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="studio-card p-5">
              <div className="flex items-start justify-between">
                <div className="space-y-3">
                  <Skeleton className="h-4 w-20 rounded-md" delay={index * 45} />
                  <Skeleton className="h-8 w-24 rounded-lg" delay={index * 45 + 30} />
                </div>
                <Skeleton className="size-10 rounded-xl" delay={index * 45 + 50} />
              </div>
              <Skeleton className="mt-4 h-3 w-32 rounded-md" delay={index * 45 + 70} />
            </div>
          ))}
        </div>

        <div className="studio-card overflow-hidden p-5">
          <div className="flex items-center justify-between gap-4 pb-4">
            <Skeleton className="h-10 w-72 max-w-full rounded-xl" />
            <Skeleton className="h-9 w-28 rounded-full" />
          </div>
          <div className="space-y-3 pt-2">
            {[0, 1, 2, 3, 4].map((row) => (
              <Skeleton
                key={row}
                className="h-14 w-full rounded-xl"
                delay={row * 40}
              />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
