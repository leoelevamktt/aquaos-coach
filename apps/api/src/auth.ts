import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Role, User } from "@natacao/domain";

type DemoAccount = User & { passwordHash: string };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const accounts: DemoAccount[] = [
  { id: "user-coach", organizationId: "org-demo", name: "Marcos Costa", email: "coach@natacao.local", role: "coach", passwordHash: hash("natacao-demo") },
  { id: "user-athlete", organizationId: "org-demo", name: "Ana Souza", email: "ana@natacao.local", role: "athlete", athleteId: "ath-ana", passwordHash: hash("natacao-demo") },
];
const sessions = new Map<string, User>();

export function login(email: string, password: string) {
  const account = accounts.find((candidate) => candidate.email.toLowerCase() === email.toLowerCase());
  if (!account) return undefined;
  const expected = Buffer.from(account.passwordHash);
  const received = Buffer.from(hash(password));
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return undefined;
  const { passwordHash: _passwordHash, ...user } = account;
  const token = randomBytes(32).toString("hex");
  sessions.set(token, user);
  return { token, user };
}

export function getSession(token?: string) { return token ? sessions.get(token) : undefined; }
export function logout(token?: string) { if (token) sessions.delete(token); }
export function roleAllows(user: User | undefined, roles: Role[]) { return Boolean(user && roles.includes(user.role)); }

export function sessionToken(request: { headers: Record<string, string | string[] | undefined> }) {
  const header = request.headers.cookie ?? "";
  const match = typeof header === "string" ? header.match(/(?:^|;\s*)natacao_session=([^;]+)/) : undefined;
  return match?.[1];
}
