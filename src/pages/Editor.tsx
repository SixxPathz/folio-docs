import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { api, ApiError, when, type Doc } from "../api";
import Masthead, { Avatar } from "../components/Masthead";
import Toolbar from "../components/Toolbar";
import SharePanel from "../components/SharePanel";

type Status = "saved" | "dirty" | "saving" | "offline" | "conflict" | "error";

export default function EditorPage() {
  const { id = "" } = useParams();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    setDoc(null);
    setError(null);
    api.get(id).then(setDoc, setError);
  }, [id]);

  return (
    <div className="page">
      <Masthead>
        <Link to="/" className="crumb">← The Index</Link>
      </Masthead>
      {error && (
        <main className="missing">
          <p className="kicker">Error {error.status || ""}</p>
          <h1 className="headline">{error.status === 404 ? "This document isn't on your desk." : "We couldn't open that."}</h1>
          <p>{error.status === 404 ? "It may have been deleted, or it hasn't been shared with you." : error.message}</p>
          <Link className="btn btn--ink" to="/">Back to the Index</Link>
        </main>
      )}
      {!doc && !error && <div className="loading">Fetching the draft…</div>}
      {doc && <Workspace key={doc.id} initial={doc} />}
    </div>
  );
}

function Workspace({ initial }: { initial: Doc }) {
  const location = useLocation();
  const [meta, setMeta] = useState<Doc>(initial);
  const [title, setTitle] = useState(initial.title);
  const [status, setStatus] = useState<Status>("saved");
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Doc | null>(null);
  const [words, setWords] = useState(0);
  const canEdit = initial.role !== "viewer";

  // --- autosave machinery: debounced, one request in flight, optimistic concurrency via `version` ---
  const version = useRef(initial.version);
  const pending = useRef<{ title?: string; content?: string }>({});
  const inflight = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const conflictRef = useRef(false);
  const flushRef = useRef<() => void>(() => {});

  const schedule = (ms = 800) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => flushRef.current(), ms);
  };

  const queue = (patch: { title?: string; content?: string }) => {
    pending.current = { ...pending.current, ...patch };
    if (!conflictRef.current) setStatus("dirty");
    schedule();
  };

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    if (inflight.current || conflictRef.current) return;
    const patch = pending.current;
    if (patch.title === undefined && patch.content === undefined) return;
    pending.current = {};
    inflight.current = true;
    setStatus("saving");
    try {
      const saved = await api.save(initial.id, { ...patch, version: version.current });
      version.current = saved.version;
      setMeta(saved);
      setMessage(null);
      setStatus(Object.keys(pending.current).length ? "dirty" : "saved");
    } catch (e) {
      const err = e as ApiError;
      pending.current = { ...patch, ...pending.current }; // never drop the user's edits
      if (err.status === 409) {
        conflictRef.current = true;
        setConflict(err.body.latest as Doc);
        setStatus("conflict");
      } else if (err.status === 0 || err.status >= 500) {
        setStatus("offline");
        setMessage(err.message);
        schedule(4000); // retry
      } else {
        setStatus("error");
        setMessage(err.message);
      }
    } finally {
      inflight.current = false;
      if (!conflictRef.current && Object.keys(pending.current).length && timer.current === undefined) schedule();
    }
  }, [initial.id]);
  flushRef.current = flush;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true } }),
      Placeholder.configure({ placeholder: canEdit ? "Start writing — or use “Insert file” to pull in a .txt, .md or .docx." : "This document is empty." }),
    ],
    content: initial.content,
    editable: canEdit,
    editorProps: { attributes: { class: "prose", spellcheck: "true", "aria-label": "Document body" } },
    onCreate: ({ editor }) => setWords(countWords(editor.getText())),
    onUpdate: ({ editor }) => {
      setWords(countWords(editor.getText()));
      queue({ content: editor.getHTML() });
    },
  });

  // Ctrl/Cmd+S saves now; warn before leaving with unsaved edits; flush on unmount.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        flushRef.current();
      }
    };
    const onLeave = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length || inflight.current) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onLeave);
      flushRef.current();
    };
  }, []);

  // New drafts land with the title selected so renaming is the first thing you do.
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if ((location.state as { fresh?: boolean } | null)?.fresh) titleRef.current?.select();
  }, [location.state]);

  function onTitle(v: string) {
    const clean = v.replace(/\n/g, "");
    setTitle(clean);
    if (clean.trim()) queue({ title: clean.trim() });
  }

  function resolveConflict(keep: "mine" | "theirs") {
    if (!conflict || !editor) return;
    version.current = conflict.version;
    conflictRef.current = false;
    if (keep === "theirs") {
      pending.current = {};
      editor.commands.setContent(conflict.content, { emitUpdate: false });
      setTitle(conflict.title);
      setMeta(conflict);
      setStatus("saved");
    } else {
      pending.current = { title: title.trim() || meta.title, content: editor.getHTML() };
      flushRef.current();
    }
    setConflict(null);
  }

  return (
    <main className="desk">
      <div className="desk__main">
        {canEdit ? (
          <Toolbar editor={editor} docTitle={title} />
        ) : (
          <div className="viewbar">
            <span className="tag tag--view">View only</span>
            <span>{meta.owner.name} shared this with you to read. Ask them for edit access to make changes.</span>
          </div>
        )}

        {conflict && (
          <div className="conflict" role="alert">
            <strong>{conflict.updatedBy ?? "Someone"} saved a newer version while you were editing.</strong>
            <span>Your changes are safe in this tab. Choose which version to keep:</span>
            <div>
              <button className="btn btn--ink" onClick={() => resolveConflict("mine")}>Keep mine (overwrite)</button>
              <button className="btn" onClick={() => resolveConflict("theirs")}>Load theirs (discard mine)</button>
            </div>
          </div>
        )}

        <article className="sheet">
          <textarea
            ref={titleRef}
            className="sheet__title"
            value={title}
            onChange={(e) => onTitle(e.target.value)}
            onBlur={() => { if (!title.trim()) onTitle(meta.title || "Untitled draft"); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); editor?.commands.focus("start"); } }}
            readOnly={!canEdit}
            rows={1}
            maxLength={120}
            aria-label="Document title"
            placeholder="Untitled draft"
          />
          <p className="sheet__byline">
            By {meta.owner.name}
            {meta.source && <> · imported from <span className="mono">{meta.source}</span></>}
          </p>
          <EditorContent editor={editor} />
        </article>
      </div>

      <aside className="margin">
        <div className="margin__block">
          <p className="label">Status</p>
          {canEdit ? (
            <SaveState status={status} updatedAt={meta.updatedAt} message={message} onRetry={() => { setStatus("dirty"); flushRef.current(); }} />
          ) : (
            <div className="save"><span className="save__dot" style={{ background: "var(--ochre)" }} />Read-only · updated {when(meta.updatedAt)}</div>
          )}
          <p className="margin__fine">
            {words.toLocaleString()} words · last edit by {meta.updatedBy ?? "—"} {when(meta.updatedAt)}
          </p>
        </div>

        <div className="margin__block">
          <p className="label">Owner</p>
          <p className="person">
            <Avatar name={meta.owner.name} color={meta.owner.color} size={24} />
            <span>{meta.owner.name}{initial.role === "owner" && <em> (you)</em>}</span>
          </p>
          <p className="margin__fine">Your access: <strong>{roleLabel(initial.role)}</strong></p>
        </div>

        <SharePanel doc={meta} onShares={(shares) => setMeta((m) => ({ ...m, shares }))} />
      </aside>
    </main>
  );
}

function SaveState({ status, updatedAt, message, onRetry }: { status: Status; updatedAt: string; message: string | null; onRetry: () => void }) {
  const text: Record<Status, string> = {
    saved: `Saved ${when(updatedAt)}`,
    dirty: "Unsaved changes…",
    saving: "Saving…",
    offline: "Offline — retrying",
    conflict: "Version conflict",
    error: "Not saved",
  };
  return (
    <div className={`save save--${status}`} aria-live="polite">
      <span className="save__dot" />
      <span>{text[status]}</span>
      {message && status !== "saved" && <p className="save__msg">{message} {status === "error" && <button className="link" onClick={onRetry}>Retry</button>}</p>}
    </div>
  );
}

const roleLabel = (r: Doc["role"]) => (r === "owner" ? "Owner" : r === "editor" ? "Can edit" : "View only");
const countWords = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);
