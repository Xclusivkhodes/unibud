import { RegisterForm } from "../../components/auth.js";

export default async function Register({ searchParams }: { searchParams: Promise<{ error?: string; deleted?: string }> }) {
  const query = await searchParams;
  return <RegisterForm deleted={query.deleted === "1"} initialError={query.error ?? ""} />;
}
