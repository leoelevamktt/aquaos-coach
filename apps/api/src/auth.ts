import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Role, User } from "@natacao/domain";

type DemoAccount = User & { passwordHash: string; passwordSalt: string; cpf?: string };
const derive = (value: string, salt: string) => scryptSync(value, salt, 32).toString("hex");
const demoSalt = "rkf-local-validation-v1";
const prodCoachSalt = "rkf-prod-eleva-v1";
const prodAthleteSalt = "rkf-prod-eleva-ath-v1";
const accounts: DemoAccount[] = [
  // Contas de produção — válidas em qualquer ambiente
  { id: "user-prod-coach", organizationId: "org-demo", name: "Treinador Eleva", email: "treinador@elevamkt.digital", role: "coach", passwordSalt: prodCoachSalt, passwordHash: derive("rseq-6X77BGm", prodCoachSalt) },
  { id: "user-prod-athlete", organizationId: "org-demo", name: "Ana Souza", email: "atleta@elevamkt.digital", role: "athlete", athleteId: "ana-souza", passwordSalt: prodAthleteSalt, passwordHash: derive("natacao-atleta-2026", prodAthleteSalt) },
  { id: "user-coach", organizationId: "org-demo", name: "Marcos Costa", email: "coach@natacao.local", role: "coach", passwordSalt: demoSalt, passwordHash: derive("natacao-demo", demoSalt) },
  { id: "user-athlete", organizationId: "org-demo", name: "Ana Souza", email: "ana@natacao.local", cpf: "123.456.789-00", role: "athlete", athleteId: "ana-souza", passwordSalt: demoSalt, passwordHash: derive("natacao-demo", demoSalt) },
];
const sessions = new Map<string, { user: User; expiresAt: number }>();

export function login(identifier: string, password: string) {
  const normalized = identifier.trim().toLowerCase();
  const cpfDigits = normalized.replace(/\D/g, "");
  const account = accounts.find((candidate) => candidate.email.toLowerCase() === normalized || Boolean(candidate.cpf && candidate.cpf.replace(/\D/g, "") === cpfDigits));
  if (!account) return undefined;
  const expected = Buffer.from(account.passwordHash);
  const received = Buffer.from(derive(password, account.passwordSalt));
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return undefined;
  const { passwordHash: _passwordHash, passwordSalt: _passwordSalt, cpf: _cpf, ...user } = account;
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { user, expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
  return { token, user };
}

export function getSession(token?: string) {
  if (!token) return undefined;
  const session = sessions.get(token);
  if (!session) return undefined;
  if (session.expiresAt <= Date.now()) { sessions.delete(token); return undefined; }
  return session.user;
}
export function logout(token?: string) { if (token) sessions.delete(token); }
export function roleAllows(user: User | undefined, roles: Role[]) { return Boolean(user && roles.includes(user.role)); }

/**
 * Verifica se o atleta pode acessar o recurso do athleteId informado.
 * Sem allowlists literais: apenas o próprio athleteId da sessão vale. Contas
 * sem athleteId vinculado (configuração incompleta) não veem nada de outros.
 */
export function athleteMayAccess(user: User | undefined, athleteId: string) {
  if (!user) return false;
  if (user.role !== "athlete") return true;
  return Boolean(user.athleteId) && user.athleteId === athleteId;
}

export function sessionToken(request: { headers: Record<string, string | string[] | undefined> }) {
  const header = request.headers.cookie ?? "";
  const match = typeof header === "string" ? header.match(/(?:^|;\s*)(?:__Host-natacao_session|natacao_session)=([^;]+)/) : undefined;
  return match?.[1];
}
