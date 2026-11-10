import { LoginForm } from "../../components/auth.js";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const query = await searchParams;
  return <LoginForm initialError={query.error ?? ""} />;
}
