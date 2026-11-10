import { redirect } from "next/navigation";
import { currentUser } from "../server/session.js";

export default async function Home() {
  const user = await currentUser();
  redirect(user ? "/today" : "/login");
}
