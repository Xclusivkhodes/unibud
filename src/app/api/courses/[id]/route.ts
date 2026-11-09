import { getAppDb } from "../../../../server/appdb.js";
import { handleApi } from "../../../../server/api.js";

export const runtime = "nodejs";

export function GET(request: Request) {
  return handleApi(request, getAppDb());
}
