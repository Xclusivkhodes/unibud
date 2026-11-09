import { getAppDb } from "../../../server/appdb.js";
import { handleApi } from "../../../server/api.js";

export const runtime = "nodejs";

async function dispatch(request: Request) {
  return handleApi(request, getAppDb());
}

export const GET = dispatch;
export const POST = dispatch;
export const DELETE = dispatch;
