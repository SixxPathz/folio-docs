import { Link, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { api, initials } from "../api";
import { useSession } from "../App";

export function Avatar({ name, color, size = 28 }: { name: string; color: string; size?: number }) {
  return (
    <span className="avatar" style={{ background: color, width: size, height: size, fontSize: size * 0.4 }} title={name}>
      {initials(name)}
    </span>
  );
}

export default function Masthead({ children }: { children?: ReactNode }) {
  const { user, setUser } = useSession();
  const nav = useNavigate();

  async function signOut() {
    await api.logout().catch(() => {});
    setUser(null);
    nav("/");
  }

  return (
    <header className="mast">
      <Link to="/" className="mast__brand" aria-label="Folio — back to index">
        <span className="mast__mark">F</span>
        <span className="mast__word">Folio</span>
      </Link>
      <div className="mast__mid">{children}</div>
      <div className="mast__me">
        <Avatar name={user.name} color={user.color} />
        <span className="mast__name">{user.name.split(" ")[0]}</span>
        <button className="link" onClick={signOut}>Switch user</button>
      </div>
    </header>
  );
}
