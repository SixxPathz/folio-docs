import { useEffect, useState } from "react";
import { api, initials, type User } from "../api";

export default function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.users().then(setUsers, (e) => setError(e.message));
  }, []);

  async function pick(u: User) {
    setBusy(u.id);
    setError(null);
    try {
      onLogin(await api.login(u.email));
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <main className="login">
      <div className="login__rule" aria-hidden />
      <header className="login__mast">
        <p className="kicker">{today} · Internal edition</p>
        <h1 className="wordmark">Folio</h1>
        <p className="login__deck">Shared drafts for teams who'd rather be writing than hunting for the latest version.</p>
      </header>

      <section className="login__desk" aria-labelledby="who">
        <h2 id="who" className="label">Sign in as</h2>
        <ul className="passes">
          {users.map((u, i) => (
            <li key={u.id}>
              <button className="pass" onClick={() => pick(u)} disabled={!!busy} style={{ ["--c" as string]: u.color }}>
                <span className="pass__no">No. {String(i + 1).padStart(2, "0")}</span>
                <span className="pass__stamp">{initials(u.name)}</span>
                <span className="pass__name">{u.name}</span>
                <span className="pass__mail">{u.email}</span>
                <span className="pass__go">{busy === u.id ? "Opening…" : "Enter →"}</span>
              </button>
            </li>
          ))}
        </ul>
        {error && <p className="alert" role="alert">{error}</p>}
        <p className="fineprint">
          Demo accounts. Authentication is mocked on purpose so reviewers can switch people in one click and test sharing.
        </p>
      </section>
    </main>
  );
}
