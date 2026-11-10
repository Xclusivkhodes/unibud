import { all } from "../../db.js";
import { Shell } from "../../components/Shell.js";
import { getAppDb } from "../../server/appdb.js";
import { profileOf, requireUser } from "../../server/session.js";

export const dynamic = "force-dynamic";

export default async function StudyLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const courses = all<{ id: string; name: string }>(getAppDb(), "SELECT id, name FROM courses WHERE user_id = ? ORDER BY created_at", user.id);
  const profile = profileOf(user.id);
  return <Shell displayName={profile?.display_name ?? ""} courses={courses}>{children}</Shell>;
}
