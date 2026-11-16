import { storageAdminResponse } from "@/lib/storage/image-management";
import { imageStoragePolicySchema } from "@/lib/validators";

export async function PATCH(request: Request) {
  return storageAdminResponse(async (_admin, repository) =>
    repository.updateStoragePolicy(imageStoragePolicySchema.parse(await request.json())));
}
