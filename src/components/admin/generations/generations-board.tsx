"use client";

import { useState } from "react";

import {
  GenerationAdminCard,
  GenerationAdminList,
  type GenerationAdminJob,
} from "@/components/admin/admin-actions";
import { GenerationDiagnosticDrawer } from "./generation-diagnostic-drawer";

type GenerationsBoardProps = {
  jobs: GenerationAdminJob[];
  view: "card" | "list";
};

export function GenerationsBoard({ jobs, view }: GenerationsBoardProps) {
  const [inspectJobId, setInspectJobId] = useState<string | null>(null);

  return (
    <>
      {view === "list" ? (
        <GenerationAdminList
          jobs={jobs}
          onInspectJob={(job) => setInspectJobId(job.id)}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {jobs.map((job) => (
            <GenerationAdminCard
              key={job.id}
              job={job}
              onInspectJob={(target) => setInspectJobId(target.id)}
            />
          ))}
        </div>
      )}

      <GenerationDiagnosticDrawer
        jobId={inspectJobId}
        onClose={() => setInspectJobId(null)}
      />
    </>
  );
}
