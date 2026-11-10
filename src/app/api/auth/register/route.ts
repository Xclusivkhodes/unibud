import { getAppDb } from "../../../../server/appdb.js";
import { handleApi } from "../../../../server/api.js";

export const runtime = "nodejs";

export function POST(request: Request) {
  return handleApi(request, getAppDb());
}
