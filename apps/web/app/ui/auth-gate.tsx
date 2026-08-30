"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, LockKeyhole, Waves } from "lucide-react";
import { apiRequest } from "./api";

export type SessionUser = { id: string; name: string; email: string; role: string; athleteId?: string };

/**
 * Gate de autenticação do painel do coach.
 * Em dev mantém o auto-login demo; em produção exige credenciais reais.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "signin" | "ready">("checking");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void apiRequest<{ user: SessionUser }>("/api/v1/auth/me")
      .then((response) => { setUser(response.user); setState("ready"); })
      .catch(() => {
        if (process.env.NODE_ENV !== "production") {
          void apiRequest<{ user: SessionUser }>("/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "coach@natacao.local", password: "natacao-demo" }) })
            .then((response) => { setUser(response.user); setState("ready"); })
            .catch(() => setState("signin"));
        } else setState("signin");
      });
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) { setError("Informe e-mail e senha."); return; }
    setSubmitting(true); setError("");
    try {
      const response = await apiRequest<{ user: SessionUser }>("/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim(), password }) });
      setUser(response.user);
      setState("ready");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Falha no login");
    } finally {
      setSubmitting(false);
    }
  };

  if (state === "checking") {
    return <div className="auth-gate"><div className="auth-card auth-loading"><LoaderCircle className="spin" size={28} /><span>Verificando sessão…</span></div></div>;
  }

  if (state === "signin") {
    return <div className="auth-gate">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand"><span className="brand-mark"><Waves size={24} /></span><div><strong>RKF <em>Coach</em></strong><small>Plataforma de natação</small></div></div>
        <label className="auth-field"><span>E-mail</span><input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="treinador@elevamkt.digital" autoFocus /></label>
        <label className="auth-field"><span>Senha</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••••" /></label>
        {error && <p className="auth-error">{error}</p>}
        <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Entrando…" : <><LockKeyhole size={16} />Entrar</>}</button>
        <p className="auth-hint">Acesso restrito à comissão técnica.</p>
      </form>
    </div>;
  }

  return <>{children}</>;
}
