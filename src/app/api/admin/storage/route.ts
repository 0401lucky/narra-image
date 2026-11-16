import { getStorageManagementOverview, storageAdminResponse } from "@/lib/storage/image-management";

export const dynamic = "force-dynamic";

export async function GET() {
  return storageAdminResponse(() => getStorageManagementOverview());
}
