import { storageAdminResponse } from "@/lib/storage/image-management";
import { imageCleanupConfirmSchema } from "@/lib/validators";

export async function POST(request: Request) {
  return storageAdminResponse(async (admin, repository) => repository.confirmCleanup({
    ...imageCleanupConfirmSchema.parse(await request.json()), actorId: admin.id,
  }));
}
