import { createContext, useContext, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api, type User } from "./api";
import Login from "./pages/Login";
import Library from "./pages/Library";
import Editor from "./pages/Editor";

type Session = { user: User; setUser: (u: User | null) => void };
const SessionCtx = createContext<Session | null>(null);
export const useSession = () => useContext(SessionCtx)!;

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    api.me().then(setUser, () => setUser(null));
  }, []);

  if (user === undefined) return <div className="boot">Folio</div>;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <SessionCtx.Provider value={{ user, setUser }}>
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/d/:id" element={<Editor />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SessionCtx.Provider>
  );
}
