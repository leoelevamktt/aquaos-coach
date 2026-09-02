"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, LockKeyhole, LogOut, UserRound, Waves } from "lucide-react";
import { apiRequest } from "./api";

export type SessionUser = { id: string; name: string; email: string; role: string; athleteId?: string };

export const SKIP_DEMO_LOGIN_KEY = "rkf_skip_demo_autologin";

/**
 * Gate de autenticação do painel do coach.
 * Em dev mantém o auto-login demo; em produção exige credenciais reais.
 * Exige role "coach" ou "admin": sessões de atleta recebem um interstitial.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "signin" | "ready" | "denied">("checking");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void apiRequest<{ user: SessionUser }>("/api/v1/auth/me")
      .then((response) => { setUser(response.user); setState(response.user.role === "coach" || response.user.role === "admin" ? "ready" : "denied"); })
      .catch(() => {
        const skipDemoLogin = window.sessionStorage.getItem(SKIP_DEMO_LOGIN_KEY) === "1";
        if (process.env.NODE_ENV !== "production" && !skipDemoLogin) {
          void apiRequest<{ user: SessionUser }>("/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "coach@natacao.local", password: "natacao-demo" }) })
            .then((response) => { setUser(response.user); setState(response.user.role === "coach" || response.user.role === "admin" ? "ready" : "denied"); })
            .catch(() => setState("signin"));
        } else setState("signin");
      });
  }, []);

  const logout = async () => {
    setSubmitting(true);
    try { await apiRequest("/api/v1/auth/logout", { method: "POST" }); } catch { /* sessão já inválida */ }
    window.sessionStorage.setItem(SKIP_DEMO_LOGIN_KEY, "1");
    setUser(null); setEmail(""); setPassword(""); setError("");
    setSubmitting(false);
    setState("signin");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) { setError("Informe e-mail e senha."); return; }
    setSubmitting(true); setError("");
    try {
      const response = await apiRequest<{ user: SessionUser }>("/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim(), password }) });
      window.sessionStorage.removeItem(SKIP_DEMO_LOGIN_KEY);
      setUser(response.user);
      if (response.user.role === "coach" || response.user.role === "admin") setState("ready");
      else setState("denied");
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

  if (state === "denied") {
    return <div className="auth-gate">
      <div className="auth-card auth-denied">
        <div className="auth-brand"><span className="brand-mark"><Waves size={24} /></span><div><strong>RKF <em>Coach</em></strong><small>Plataforma de natação</small></div></div>
        <div className="auth-denied-icon"><UserRound size={30} /></div>
        <h2 className="auth-denied-title">Acesso do treinador</h2>
        <p className="auth-denied-text">A conta logada ({user?.email ?? "sessão atual"}) é de <strong>atleta</strong> e não pode acessar o painel do treinador. Use o app do atleta ou encerre a sessão para entrar com outra conta.</p>
        <a className="primary-button auth-denied-link" href="/pt/athlete/welcome">Ir para o app do atleta</a>
        <button className="primary-button auth-denied-logout" type="button" onClick={() => void logout()} disabled={submitting}>
          {submitting ? <><LoaderCircle className="spin" size={16} />Saindo…</> : <><LogOut size={16} />Sair da conta</>}
        </button>
      </div>
    </div>;
  }

  return <>{children}</>;
}
