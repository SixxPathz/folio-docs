export type User = { id: string; email: string; name: string; color: string };
export type Role = "owner" | "editor" | "viewer";
export type Share = User & { role: "viewer" | "editor" };

export type Doc = {
  id: string;
  title: string;
  content: string;
  version: number;
  source: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
  owner: User;
  shares: Share[];
  role: Role;
};

export type OwnedRow = { id: string; title: string; updatedAt: string; updatedBy: string | null; source: string | null; shareCount: number };
export type SharedRow = { id: string; title: string; updatedAt: string; updatedBy: string | null; source: string | null; role: "viewer" | "editor"; owner: { name: string; color: string } };

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: Record<string, unknown> = {}) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(0, "Can't reach the server — check your connection");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data);
  return data as T;
}

const file = (f: File) => {
  const fd = new FormData();
  fd.append("file", f);
  return fd;
};

export const api = {
  users: () => request<User[]>("GET", "/api/users"),
  me: () => request<User>("GET", "/api/auth/me"),
  login: (email: string) => request<User>("POST", "/api/auth/login", { email }),
  logout: () => request<void>("POST", "/api/auth/logout"),

  list: () => request<{ owned: OwnedRow[]; shared: SharedRow[] }>("GET", "/api/documents"),
  create: (title?: string) => request<Doc>("POST", "/api/documents", title ? { title } : {}),
  get: (id: string) => request<Doc>("GET", `/api/documents/${id}`),
  save: (id: string, patch: { title?: string; content?: string; version: number }) => request<Doc>("PATCH", `/api/documents/${id}`, patch),
  remove: (id: string) => request<void>("DELETE", `/api/documents/${id}`),
  importFile: (f: File) => request<Doc>("POST", "/api/documents/import", file(f)),
  convertFile: (f: File) => request<{ html: string }>("POST", "/api/convert", file(f)),

  share: (id: string, email: string, role: "viewer" | "editor") => request<Share[]>("POST", `/api/documents/${id}/shares`, { email, role }),
  unshare: (id: string, userId: string) => request<Share[]>("DELETE", `/api/documents/${id}/shares/${userId}`),
};

export const ACCEPTED_FILES = ".txt,.md,.markdown,.docx";
export const ACCEPTED_LABEL = ".txt · .md · .docx — up to 2 MB";

export function initials(name: string) {
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

export function when(iso: string) {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: diff > 3e7 ? "numeric" : undefined });
}
