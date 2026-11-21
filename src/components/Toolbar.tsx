import { useRef, useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import TurndownService from "turndown";
import { ACCEPTED_FILES, ACCEPTED_LABEL, api } from "../api";

type Btn = { label: React.ReactNode; title: string; run: () => void; active?: boolean; disabled?: boolean; className?: string };

export default function Toolbar({ editor, docTitle }: { editor: Editor | null; docTitle: string }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const s = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e && {
        p: e.isActive("paragraph"),
        h1: e.isActive("heading", { level: 1 }),
        h2: e.isActive("heading", { level: 2 }),
        h3: e.isActive("heading", { level: 3 }),
        bold: e.isActive("bold"),
        italic: e.isActive("italic"),
        underline: e.isActive("underline"),
        strike: e.isActive("strike"),
        bullet: e.isActive("bulletList"),
        ordered: e.isActive("orderedList"),
        quote: e.isActive("blockquote"),
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
      },
  });
  if (!editor || !s) return <div className="toolbar" />;
  const c = () => editor.chain().focus();

  const groups: Btn[][] = [
    [
      { label: "Body", title: "Body text (Ctrl+Alt+0)", run: () => c().setParagraph().run(), active: s.p, className: "tb--word" },
      { label: "H1", title: "Title heading (Ctrl+Alt+1)", run: () => c().toggleHeading({ level: 1 }).run(), active: s.h1 },
      { label: "H2", title: "Section heading (Ctrl+Alt+2)", run: () => c().toggleHeading({ level: 2 }).run(), active: s.h2 },
      { label: "H3", title: "Sub-heading (Ctrl+Alt+3)", run: () => c().toggleHeading({ level: 3 }).run(), active: s.h3 },
    ],
    [
      { label: <b>B</b>, title: "Bold (Ctrl+B)", run: () => c().toggleBold().run(), active: s.bold },
      { label: <i>I</i>, title: "Italic (Ctrl+I)", run: () => c().toggleItalic().run(), active: s.italic },
      { label: <u>U</u>, title: "Underline (Ctrl+U)", run: () => c().toggleUnderline().run(), active: s.underline },
      { label: <s>S</s>, title: "Strikethrough (Ctrl+Shift+S)", run: () => c().toggleStrike().run(), active: s.strike },
    ],
    [
      { label: <ListIcon />, title: "Bulleted list (Ctrl+Shift+8)", run: () => c().toggleBulletList().run(), active: s.bullet },
      { label: <OrderedIcon />, title: "Numbered list (Ctrl+Shift+7)", run: () => c().toggleOrderedList().run(), active: s.ordered },
      { label: "❝", title: "Quote (Ctrl+Shift+B)", run: () => c().toggleBlockquote().run(), active: s.quote },
    ],
    [
      { label: "↶", title: "Undo (Ctrl+Z)", run: () => c().undo().run(), disabled: !s.canUndo },
      { label: "↷", title: "Redo (Ctrl+Shift+Z)", run: () => c().redo().run(), disabled: !s.canRedo },
    ],
  ];

  async function insertFile(f: File | undefined) {
    if (!f || !editor) return;
    setBusy(true);
    setNote(null);
    try {
      const { html } = await api.convertFile(f);
      if (!html) throw new Error("That file has no readable text");
      editor.chain().focus().insertContent(html).run();
      setNote({ kind: "ok", text: `Inserted “${f.name}” at the cursor` });
    } catch (e) {
      setNote({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function exportMarkdown() {
    if (!editor) return;
    const td = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" });
    td.addRule("underline", { filter: ["u"], replacement: (content) => `<u>${content}</u>` });
    const md = `# ${docTitle}\n\n${td.turndown(editor.getHTML())}\n`;
    const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${slug(docTitle)}.md` });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="toolbar-wrap">
      <div className="toolbar" role="toolbar" aria-label="Formatting">
        {groups.map((g, i) => (
          <div className="tb-group" key={i}>
            {g.map((b) => (
              <button
                key={b.title}
                type="button"
                className={`tb ${b.className ?? ""}${b.active ? " is-on" : ""}`}
                title={b.title}
                aria-label={b.title}
                aria-pressed={b.active}
                disabled={b.disabled}
                onMouseDown={(e) => e.preventDefault()}
                onClick={b.run}
              >
                {b.label}
              </button>
            ))}
          </div>
        ))}
        <div className="tb-group tb-group--end">
          <button type="button" className="tb tb--word" onClick={() => fileInput.current?.click()} disabled={busy} title={`Insert a file at the cursor (${ACCEPTED_LABEL})`}>
            {busy ? "Reading…" : "Insert file"}
          </button>
          <button type="button" className="tb tb--word" onClick={exportMarkdown} title="Download this document as Markdown">
            Export .md
          </button>
        </div>
        <input ref={fileInput} type="file" accept={ACCEPTED_FILES} hidden onChange={(e) => { insertFile(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {note && (
        <p className={`toast toast--${note.kind}`} role="status">
          {note.text} <button className="link" onClick={() => setNote(null)}>OK</button>
        </p>
      )}
    </div>
  );
}

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "document";

const ListIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><circle cx="2.5" cy="4" r="1.3" fill="currentColor" /><circle cx="2.5" cy="8" r="1.3" fill="currentColor" /><circle cx="2.5" cy="12" r="1.3" fill="currentColor" /><path d="M6 4h9M6 8h9M6 12h9" stroke="currentColor" strokeWidth="1.4" /></svg>
);
const OrderedIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><text x="0" y="6" fontSize="5.5" fontFamily="IBM Plex Mono, monospace" fill="currentColor">1.</text><text x="0" y="14" fontSize="5.5" fontFamily="IBM Plex Mono, monospace" fill="currentColor">2.</text><path d="M7 4h8M7 12h8" stroke="currentColor" strokeWidth="1.4" /></svg>
);
