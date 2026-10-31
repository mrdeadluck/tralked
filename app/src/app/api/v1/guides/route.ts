import { createGuide } from "@/lib/api/guides";
import { handleWrite } from "@/lib/api/write";

/** POST /api/v1/guides: a bot creates the guide of a game (review queue without the publish scope). */
export function POST(request: Request) {
  return handleWrite(request, { scope: "guides:write", kind: "guide", execute: createGuide });
}
