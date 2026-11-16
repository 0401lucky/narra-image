import { storageAdminResponse } from "@/lib/storage/image-management";
import { imageCleanupCancelSchema, imageCleanupJobQuerySchema } from "@/lib/validators";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return storageAdminResponse(async (admin, repository) => {
    const { id } = await context.params;
    const { jobId } = imageCleanupJobQuerySchema.parse({ jobId: id });
    return repository.cancelMaintenance({
      ...imageCleanupCancelSchema.parse(await request.json()), actorId: admin.id, jobId,
    });
  });
}
