import { storageAdminResponse } from "@/lib/storage/image-management";
import { imageCleanupPreviewSchema } from "@/lib/validators";

export async function POST(request: Request) {
  return storageAdminResponse(async (admin, repository) => repository.previewCleanup({
    ...imageCleanupPreviewSchema.parse(await request.json()), actorId: admin.id,
  }));
}
