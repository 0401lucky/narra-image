import { ImageOff } from "lucide-react";

import { imageUnavailableMessage } from "@/lib/storage/image-availability";
import type { ImageAvailability } from "@/lib/types";
import { cn } from "@/lib/utils";

type ImageUnavailableProps = { availability?: ImageAvailability; className?: string };

export function ImageUnavailable({ availability, className }: ImageUnavailableProps) {
  return <div role="status" className={cn("flex min-h-32 flex-col items-center justify-center gap-2 bg-[var(--surface-strong)]/40 p-4 text-center text-sm text-[var(--ink-soft)]", className)}>
    <ImageOff aria-hidden className="size-7" />
    <span>{imageUnavailableMessage(availability)}</span>
  </div>;
}
