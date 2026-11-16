import type { ImageStorageOverview } from "@/lib/storage/image-maintenance-types";

export type ImageManagementOverview = ImageStorageOverview & {
  managedEnabled: boolean;
  writeBackend: "local" | "s3";
};
