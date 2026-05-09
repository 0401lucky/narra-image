import { unstable_cache } from "next/cache";

import { listFeaturedWorksPage } from "@/lib/server/works";
import { getCurrentUserRecord } from "@/lib/server/current-user";

function parseLimit(value: string | null) {
  const limit = Number.parseInt(value ?? "", 10);
  if (Number.isNaN(limit)) {
    return 24;
  }
  return limit;
}

const getAnonymousFeaturedPage = unstable_cache(
  async (cursor: string | null, limit: number) =>
    listFeaturedWorksPage({ cursor, limit }),
  ["featured-api-anonymous"],
  { revalidate: 60, tags: ["featured-works"] },
);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const user = await getCurrentUserRecord();
  const cursor = searchParams.get("cursor");
  const limit = parseLimit(searchParams.get("limit"));

  const data = user
    ? await listFeaturedWorksPage({ cursor, limit, viewerId: user.id })
    : await getAnonymousFeaturedPage(cursor, limit);

  const headers: HeadersInit = user
    ? { "Cache-Control": "private, no-store" }
    : { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" };

  return Response.json(data, { headers });
}
