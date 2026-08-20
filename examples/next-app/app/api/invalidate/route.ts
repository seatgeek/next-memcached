import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

/**
 * GET /api/invalidate?tag=tag-a&mode=hard|soft
 *
 * `updateTag` requires a Server Action context, so both modes go through
 * `revalidateTag` from this route handler:
 * hard -> revalidateTag(tag, { expire: 0 }): forces immediate recomputation
 *         on the next request (acceptance check #4's hard-invalidation leg).
 * soft -> revalidateTag(tag, 'max'): stale-while-revalidate - serves stale
 *         once before refreshing (soft-invalidation leg).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tag = url.searchParams.get("tag");
  const mode = url.searchParams.get("mode") ?? "hard";

  if (!tag) {
    return NextResponse.json({ error: "missing ?tag=" }, { status: 400 });
  }

  if (mode === "soft") {
    revalidateTag(tag, "max");
  } else {
    revalidateTag(tag, { expire: 0 });
  }

  return NextResponse.json({ tag, mode });
}
