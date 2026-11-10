import { Shell } from "../../components/Shell.js";

export const dynamic = "force-dynamic";

export default function StudyLayout({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>;
}
