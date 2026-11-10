import { loginAction } from "../actions.js";
import { ErrorNote, Field } from "../../components/Bits.js";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const query = await searchParams;
  return (
    <main className="auth stack">
      <div className="logo-plate"><img src="/brand/unibud-primary-logo-reference.png" width={1028} height={442} alt="UniBud" /></div>
      <h1 className="hero">Sign in</h1>
      <ErrorNote code={query.error} />
      <form className="stack ivory" action={loginAction}>
        <Field label="Email" name="email" type="email" required />
        <Field label="Password" name="password" type="password" required />
        <button className="btn amber" type="submit">Sign in</button>
      </form>
      <a href="/register">Create an account</a>
    </main>
  );
}
