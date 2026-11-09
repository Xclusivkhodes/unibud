import { registerAction } from "../actions.js";
import { ErrorNote, Field } from "../../components/Bits.js";

export default async function Register({ searchParams }: { searchParams: Promise<{ error?: string; deleted?: string }> }) {
  const query = await searchParams;
  return (
    <main className="auth stack">
      <div className="logo-plate"><img src="/brand/unibud-primary-logo-reference.png" width={1028} height={442} alt="UniBud" /></div>
      <h1 className="hero">Create your workspace</h1>
      <p className="lede">Name and course details are optional. Nothing here infers ability from demographics.</p>
      {query.deleted ? <p role="status">The account and its derived records were deleted.</p> : null}
      <ErrorNote code={query.error} />
      <form className="stack ivory" action={registerAction}>
        <Field label="Preferred name, optional" name="displayName" />
        <Field label="Email" name="email" type="email" required />
        <Field label="Password" name="password" type="password" required />
        <button className="btn amber" type="submit">Create account</button>
      </form>
      <a href="/login">Already registered</a>
    </main>
  );
}
