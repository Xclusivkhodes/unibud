const messages: Record<string, string> = {
  invalid_login: "Email or password was not accepted.",
  email_taken: "That email is already registered.",
  invalid_email: "Enter an email address.",
  weak_password: "Use at least 10 characters.",
  question_out_of_scope: "That question belongs to a different course or topic.",
  invalid_selection: "Choose one of the stored answers.",
  invalid_answer_key: "The answer key must point at one of the choices.",
  reveal_required: "Show the answer before you rate the card.",
  unknown_email: "No UniBud account uses that email, so nobody was invited.",
  not_found: "That record is not available to this account.",
  internal: "The action could not be completed.",
};

export function ErrorNote({ code }: { code?: string }) {
  if (!code) return null;
  return <p className="alert" role="alert">{messages[code] ?? "The action could not be completed."}</p>;
}

export function Field({ label, name, type = "text", required = false, defaultValue = "" }: { label: string; name: string; type?: string; required?: boolean; defaultValue?: string }) {
  return (
    <label className="field stack">
      {label}
      {type === "area" ? <textarea name={name} required={required} defaultValue={defaultValue} rows={4} /> : <input name={name} type={type} required={required} defaultValue={defaultValue} />}
    </label>
  );
}
