import { jsonError } from "@/lib/server/http";
import { storageAdminResponse } from "@/lib/storage/image-management";
import { imageCleanupJobQuerySchema } from "@/lib/validators";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  let missing = false;
  const response = await storageAdminResponse(async (_admin, repository) => {
    const { id } = await context.params;
    const query = imageCleanupJobQuerySchema.parse({ ...Object.fromEntries(new URL(request.url).searchParams), jobId: id });
    const job = await repository.getMaintenanceJob(query);
    missing = job === null;
    return job;
  });
  return missing ? jsonError("清理任务不存在", 404, "IMAGE_MAINTENANCE_NOT_FOUND") : response;
}
