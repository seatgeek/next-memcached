import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

/** GET /api/revalidate-path?path=/ */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const path = url.searchParams.get("path") ?? "/";
  revalidatePath(path);
  return NextResponse.json({ path });
}
