import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Role, User } from "@natacao/domain";
import type { ManagedStore } from "./managed-store.js";

/**
 * Autenticação com persistência no ManagedStore (arquivo atômico e/ou
 * PostgreSQL). Usuários têm salt e hash scrypt individuais; as senhas vivem
 * apenas no env de provisionamento, nunca no código. Sessões sobrevivem ao
 * restart da API. A API pública permanece síncrona (compatibilidade com os
 * callers e testes): a store é carregada uma vez no bootstrap e toda mutação
 * faz write-through imediato.
 */

type StoredAccount = User & { passwordHash: string; passwordSalt: string; cpf?: string };
type StoredSession = { user: User; expiresAt: number };

type AuthStore = {
  saveAccount(account: StoredAccount): void;
  deleteSession(tokenHash: string): Promise<void>;
  getSession(tokenHash: string): Promise<StoredSession | undefined>;
  saveSession(tokenHash: string, session: StoredSession): Promise<void>;
};

const derive = (value: string, salt: string) => scryptSync(value, salt, 32).toString("hex");
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const isProduction = () => process.env.NODE_ENV === "production";

const accounts = new Map<string, StoredAccount>();
const sessions = new Map<string, StoredSession>();
let store: AuthStore | undefined;
let seeded = false;

function toAuthStore(managed: ManagedStore): AuthStore {
  return {
    saveAccount(account) {
      const record = managed.get("users", account.id);
      const payload = { ...account };
      if (record) managed.update("users", account.id, payload);
      else managed.create("users", { ...payload, id: account.id, title: account.name });
    },
    deleteSession(hash) { return managed.deleteAuthSession(hash); },
    async getSession(hash) {
      const session = await managed.getAuthSession(hash);
      return session ? { user: session.user as unknown as User, expiresAt: session.expiresAt } : undefined;
    },
    saveSession(hash, session) { return managed.saveAuthSession(hash, session.user as unknown as Record<string, unknown>, session.expiresAt); },
  };
}

/** Carrega usuários/sessões persistidos e ativa write-through. Idempotente. */
export function attachAuthStore(managed: ManagedStore) {
  store = toAuthStore(managed);
  for (const record of managed.list("users")) {
    const account = record as unknown as StoredAccount;
    if (account?.id && account.email && account.passwordHash && account.passwordSalt) accounts.set(account.id, account);
  }
  ensureSeedUsers();
}

function createAccount(input: { id: string; organizationId: string; name: string; email: string; cpf?: string; role: Role; athleteId?: string; password: string }): StoredAccount {
  const passwordSalt = randomBytes(16).toString("hex");
  const account: StoredAccount = {
    id: input.id, organizationId: input.organizationId, name: input.name, email: input.email,
    cpf: input.cpf, role: input.role, athleteId: input.athleteId,
    passwordSalt, passwordHash: derive(input.password, passwordSalt),
  };
  accounts.set(account.id, account);
  store?.saveAccount(account);
  return account;
}

/** Cria a conta de atleta associada a um convite já validado. */
export function provisionInvitedAthlete(input: { athleteId: string; organizationId: string; name: string; email: string; password: string }) {
  ensureSeedUsers();
  const email = input.email.trim().toLowerCase();
  if (input.password.length < 8) return { error: "password_too_short" as const };
  if ([...accounts.values()].some((account) => account.email.toLowerCase() === email)) return { error: "email_in_use" as const };
  const account = createAccount({ id: `user-${input.athleteId}`, organizationId: input.organizationId, name: input.name, email, athleteId: input.athleteId, role: "athlete", password: input.password });
  const { passwordHash: _passwordHash, passwordSalt: _passwordSalt, cpf: _cpf, ...user } = account;
  return { user };
}

/**
 * Seeding idempotente:
 * - dev/testes: contas demo fixas (compatibilidade com a suíte existente);
 * - produção: e-mails e senhas vêm exclusivamente das env AUTH_*.
 */
export function ensureSeedUsers() {
  if (seeded) return;
  seeded = true;
  if (!isProduction()) {
    if (![...accounts.values()].some((account) => account.email === "coach@natacao.local")) {
      createAccount({ id: "user-coach", organizationId: "org-demo", name: "Marcos Costa", email: "coach@natacao.local", role: "coach", password: "natacao-demo" });
    }
    if (![...accounts.values()].some((account) => account.email === "ana@natacao.local")) {
      createAccount({ id: "user-athlete", organizationId: "org-demo", name: "Ana Souza", email: "ana@natacao.local", cpf: "123.456.789-00", role: "athlete", athleteId: "ana-souza", password: "natacao-demo" });
    }
    return;
  }
  const coachEmail = process.env.AUTH_COACH_EMAIL ?? "treinador@elevamkt.digital";
  const athleteEmail = process.env.AUTH_ATHLETE_EMAIL ?? "atleta@elevamkt.digital";
  if (![...accounts.values()].some((account) => account.email === coachEmail)) {
    const password = process.env.AUTH_COACH_PASSWORD;
    if (!password) throw new Error("AUTH_COACH_PASSWORD é obrigatória para provisionar o treinador em produção");
    createAccount({ id: "user-prod-coach", organizationId: "org-demo", name: "Treinador Eleva", email: coachEmail, role: "coach", password });
  }
  if (![...accounts.values()].some((account) => account.email === athleteEmail)) {
    const password = process.env.AUTH_ATHLETE_PASSWORD;
    if (!password) throw new Error("AUTH_ATHLETE_PASSWORD é obrigatória para provisionar o atleta em produção");
    createAccount({ id: "user-prod-athlete", organizationId: "org-demo", name: "Ana Souza", email: athleteEmail, role: "athlete", athleteId: "ana-souza", password });
  }
}

export async function login(identifier: string, password: string) {
  ensureSeedUsers();
  const normalized = identifier.trim().toLowerCase();
  const cpfDigits = normalized.replace(/\D/g, "");
  const account = [...accounts.values()].find((candidate) =>
    candidate.email.toLowerCase() === normalized || Boolean(candidate.cpf && candidate.cpf.replace(/\D/g, "") === cpfDigits));
  if (!account) return undefined;
  const expected = Buffer.from(account.passwordHash);
  const received = Buffer.from(derive(password, account.passwordSalt));
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return undefined;
  const { passwordHash: _passwordHash, passwordSalt: _passwordSalt, cpf: _cpf, ...user } = account;
  const token = randomBytes(32).toString("base64url");
  const session: StoredSession = { user, expiresAt: Date.now() + SESSION_TTL_MS };
  sessions.set(token, session);
  await store?.saveSession(tokenHash(token), session);
  return { token, user };
}

export async function getSession(token?: string) {
  if (!token) return undefined;
  const session = sessions.get(token) ?? await store?.getSession(tokenHash(token));
  if (!session) return undefined;
  if (session.expiresAt <= Date.now()) { sessions.delete(token); await store?.deleteSession(tokenHash(token)); return undefined; }
  sessions.set(token, session);
  return session.user;
}

export async function logout(token?: string) {
  if (!token) return;
  sessions.delete(token);
  await store?.deleteSession(tokenHash(token));
}

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
