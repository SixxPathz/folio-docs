import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ACCEPTED_FILES, ACCEPTED_LABEL, api, when, type OwnedRow, type SharedRow } from "../api";
import { useSession } from "../App";
import Masthead, { Avatar } from "../components/Masthead";

export default function Library() {
  const { user } = useSession();
  const nav = useNavigate();
  const [data, setData] = useState<{ owned: OwnedRow[]; shared: SharedRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"new" | "import" | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api.list().then(setData, (e) => setError(e.message));
  }, []);
  useEffect(load, [load, user.id]);

  async function newDraft() {
    setBusy("new");
    try {
      const doc = await api.create();
      nav(`/d/${doc.id}`, { state: { fresh: true } });
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  async function importFile(f: File | undefined) {
    if (!f) return;
    setBusy("import");
    setError(null);
    try {
      const doc = await api.importFile(f);
      nav(`/d/${doc.id}`);
    } catch (e) {
      setError(`Couldn't import “${f.name}”: ${(e as Error).message}`);
      setBusy(null);
    }
  }

  async function remove(row: OwnedRow) {
    if (!confirm(`Delete “${row.title}”? Anyone it's shared with will lose access too.`)) return;
    try {
      await api.remove(row.id);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    importFile(e.dataTransfer.files[0]);
  };

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  return (
    <div
      className={`page library${dragging ? " is-dragging" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={onDrop}
    >
      <Masthead />
      <main className="library__body">
        <section className="lede">
          <div>
            <p className="kicker">{today}</p>
            <h1 className="headline">The Index</h1>
            <p className="lede__deck">
              Good to see you, {user.name.split(" ")[0]}. {data ? summary(data) : "Gathering your papers…"}
            </p>
          </div>
          <div className="lede__actions">
            <button className="btn btn--ink" onClick={newDraft} disabled={!!busy}>
              {busy === "new" ? "Creating…" : "+ New draft"}
            </button>
            <button className="btn" onClick={() => fileInput.current?.click()} disabled={!!busy}>
              {busy === "import" ? "Importing…" : "Import a file"}
            </button>
            <p className="fineprint">{ACCEPTED_LABEL}. Becomes a new editable draft. Or drop a file anywhere.</p>
            <input ref={fileInput} type="file" accept={ACCEPTED_FILES} hidden onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ""; }} />
          </div>
        </section>

        {error && <p className="alert" role="alert">{error} <button className="link" onClick={() => setError(null)}>Dismiss</button></p>}

        <section className="column">
          <SectionHead title="Your drafts" count={data?.owned.length} note="You own these" />
          {data && data.owned.length === 0 && (
            <Empty>Nothing here yet. Start a <button className="link" onClick={newDraft}>new draft</button> or import a file.</Empty>
          )}
          <ol className="ledger">
            {data?.owned.map((d, i) => (
              <li key={d.id} className="entry">
                <span className="entry__no">{String(i + 1).padStart(2, "0")}</span>
                <Link to={`/d/${d.id}`} className="entry__title">{d.title}</Link>
                <span className="entry__meta">
                  Edited {when(d.updatedAt)}{d.updatedBy && d.updatedBy !== user.name ? ` by ${d.updatedBy}` : ""}
                </span>
                <span className="entry__tags">
                  <span className="tag tag--own">Owner</span>
                  {d.shareCount > 0 && <span className="tag">Shared · {d.shareCount}</span>}
                  {d.source && <span className="tag tag--ghost" title={d.source}>Imported</span>}
                </span>
                <button className="entry__x" onClick={() => remove(d)} aria-label={`Delete ${d.title}`} title="Delete">×</button>
              </li>
            ))}
          </ol>
        </section>

        <section className="column">
          <SectionHead title="Shared with you" count={data?.shared.length} note="Owned by teammates" />
          {data && data.shared.length === 0 && <Empty>When a teammate shares a document with you, it lands here.</Empty>}
          <ol className="ledger">
            {data?.shared.map((d, i) => (
              <li key={d.id} className="entry entry--shared">
                <span className="entry__no">{String(i + 1).padStart(2, "0")}</span>
                <Link to={`/d/${d.id}`} className="entry__title">{d.title}</Link>
                <span className="entry__meta">
                  <Avatar name={d.owner.name} color={d.owner.color} size={18} /> {d.owner.name} · edited {when(d.updatedAt)}
                </span>
                <span className="entry__tags">
                  <span className={`tag ${d.role === "editor" ? "tag--edit" : "tag--view"}`}>{d.role === "editor" ? "Can edit" : "View only"}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      </main>
      {dragging && <div className="dropzone" aria-hidden><span>Drop to import as a new draft<small>{ACCEPTED_LABEL}</small></span></div>}
    </div>
  );
}

function summary({ owned, shared }: { owned: OwnedRow[]; shared: SharedRow[] }) {
  const o = `${owned.length} draft${owned.length === 1 ? "" : "s"} of your own`;
  const s = shared.length ? `, ${shared.length} shared with you` : "";
  return `${o}${s}.`;
}

function SectionHead({ title, count, note }: { title: string; count?: number; note: string }) {
  return (
    <div className="sechead">
      <h2>{title}</h2>
      <span className="sechead__count">{count ?? "–"}</span>
      <span className="sechead__note">{note}</span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="empty">{children}</p>;
}
