import { listFeaturedWorksPage } from "@/lib/server/works";
import { getCurrentUserRecord } from "@/lib/server/current-user";

function parseLimit(value: string | null) {
  const limit = Number.parseInt(value ?? "", 10);
  if (Number.isNaN(limit)) {
    return 24;
  }
  return limit;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const user = await getCurrentUserRecord();
  const data = await listFeaturedWorksPage({
    cursor: searchParams.get("cursor"),
    limit: parseLimit(searchParams.get("limit")),
    viewerId: user?.id,
  });

  return Response.json(data);
}
