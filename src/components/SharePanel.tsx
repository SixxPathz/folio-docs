import { useEffect, useState, type FormEvent } from "react";
import { api, type Doc, type Share, type User } from "../api";
import { useSession } from "../App";
import { Avatar } from "./Masthead";

export default function SharePanel({ doc, onShares }: { doc: Doc; onShares: (s: Share[]) => void }) {
  const { user } = useSession();
  const isOwner = doc.role === "owner";
  const [people, setPeople] = useState<User[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "editor">("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOwner) api.users().then(setPeople, () => {});
  }, [isOwner]);

  const candidates = people.filter((p) => p.id !== user.id && !doc.shares.some((s) => s.id === p.id));

  async function run(fn: () => Promise<Share[]>) {
    setBusy(true);
    setError(null);
    try {
      onShares(await fn());
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return setError("Enter a teammate's email");
    if (await run(() => api.share(doc.id, email.trim(), role))) setEmail("");
  }

  return (
    <div className="margin__block share">
      <p className="label">Access · {doc.shares.length + 1} {doc.shares.length ? "people" : "person"}</p>

      <ul className="people">
        <li className="person">
          <Avatar name={doc.owner.name} color={doc.owner.color} size={24} />
          <span className="person__name">{doc.owner.name}</span>
          <span className="tag tag--own">Owner</span>
        </li>
        {doc.shares.map((s) => (
          <li className="person" key={s.id}>
            <Avatar name={s.name} color={s.color} size={24} />
            <span className="person__name">{s.name}{s.id === user.id && <em> (you)</em>}</span>
            {isOwner ? (
              <span className="person__ctl">
                <select
                  value={s.role}
                  disabled={busy}
                  aria-label={`${s.name}'s access`}
                  onChange={(e) => run(() => api.share(doc.id, s.email, e.target.value as "viewer" | "editor"))}
                >
                  <option value="editor">Can edit</option>
                  <option value="viewer">View only</option>
                </select>
                <button className="x" disabled={busy} onClick={() => run(() => api.unshare(doc.id, s.id))} aria-label={`Remove ${s.name}`} title="Remove access">×</button>
              </span>
            ) : (
              <span className={`tag ${s.role === "editor" ? "tag--edit" : "tag--view"}`}>{s.role === "editor" ? "Can edit" : "View only"}</span>
            )}
          </li>
        ))}
      </ul>

      {isOwner ? (
        <form className="share__form" onSubmit={submit} noValidate>
          <label className="label" htmlFor="share-email">Share with a teammate</label>
          <input
            id="share-email"
            type="email"
            list="share-people"
            placeholder="name@ajaia.test"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
          />
          <datalist id="share-people">
            {candidates.map((p) => <option key={p.id} value={p.email}>{p.name}</option>)}
          </datalist>
          <div className="share__row">
            <select value={role} onChange={(e) => setRole(e.target.value as "viewer" | "editor")} aria-label="Access level">
              <option value="editor">Can edit</option>
              <option value="viewer">View only</option>
            </select>
            <button className="btn btn--ink btn--sm" disabled={busy}>{busy ? "Sharing…" : "Share"}</button>
          </div>
          {candidates.length > 0 && (
            <p className="margin__fine">
              Try: {candidates.map((p, i) => (
                <span key={p.id}>{i > 0 && ", "}<button type="button" className="link" onClick={() => setEmail(p.email)}>{p.email}</button></span>
              ))}
            </p>
          )}
        </form>
      ) : (
        <p className="margin__fine">Only {doc.owner.name.split(" ")[0]} can change who has access.</p>
      )}
      {error && <p className="alert alert--sm" role="alert">{error}</p>}
    </div>
  );
}
