"use client";

import { useEffect, useState, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Check, ClipboardCheck, Clock3, Dumbbell, Eye, EyeOff, Flag, Headphones,
  HeartPulse, ListChecks, LoaderCircle, Medal, Minus, Moon, Plus, ShieldCheck,
  Sparkles, Trophy, UserRound,
} from "lucide-react";
import { apiRequest } from "./api";
import {
  AppHeader,
  AthleteButton,
  AthleteLoading,
  AthleteMark,
  AthleteState,
  BottomNav,
  Field,
} from "./athlete/components";
import {
  AthleteHome,
  AthleteSessionView,
  CheckInScreen,
  CheckoutForm,
  ResultsForm,
} from "./athlete/daily-screens";
import {
  CompetitionResult,
  Competitions,
  MoreView,
  PhaseView,
  WeekView,
} from "./athlete/secondary-screens";
import {
  defaultOnboardingProfile,
  onboardingDraftKey,
  readOnboardingDraft,
  routeFor,
  screenFromPath,
  type AthleteAppData,
  type AthleteScreen,
  type OnboardingProfile,
} from "./athlete/types";

export default function AthleteApp() {
  const pathname = usePathname();
  const router = useRouter();
  const screen = screenFromPath(pathname);
  const onboardingStep = screen === "onboarding" ? Math.max(1, Math.min(6, Number(pathname.split("/").pop()) || 1)) : 1;
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [appData, setAppData] = useState<AthleteAppData | null>(null);
  const [appLoading, setAppLoading] = useState(false);
  const [selectedMeetId, setSelectedMeetId] = useState("");
  const [sessions, setSessions] = useState(() => readOnboardingDraft()?.sessions ?? 8);
  const [days, setDays] = useState(() => readOnboardingDraft()?.days ?? ["SEG", "TER", "QUA", "QUI", "SEX"]);
  const [periods, setPeriods] = useState(() => readOnboardingDraft()?.periods ?? ["Manhã", "Tarde"]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [authState, setAuthState] = useState<"checking" | "signed-out" | "signed-in" | "denied" | "unlinked">("checking");
  const [athleteId, setAthleteId] = useState("");
  const [athleteName, setAthleteName] = useState("Atleta");
  const [onboardingProfile, setOnboardingProfile] = useState<OnboardingProfile>(() => readOnboardingDraft()?.profile ?? defaultOnboardingProfile);
  const [inviteToken, setInviteToken] = useState(() => typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("invite") ?? "" : "");
  const [inviteState, setInviteState] = useState<"idle" | "checking" | "valid" | "invalid">("idle");
  const go = (next: AthleteScreen, step?: number) => {
    const target = routeFor(next, step);
    router.push(inviteToken && next === "onboarding" ? `${target}?invite=${encodeURIComponent(inviteToken)}` : target);
  };
  const athleteFirstName = athleteName.trim().split(/\s+/)[0] || "Atleta";
  const loadAthleteData = async () => {
    setAppLoading(true);
    try {
      const data = await apiRequest<AthleteAppData>("/api/v1/athlete/app");
      setAppData(data);
      if (data.athlete.name) setAthleteName(data.athlete.name);
      return data;
    } finally {
      setAppLoading(false);
    }
  };
  useEffect(() => {
    if (screen !== "onboarding" || typeof window === "undefined") return;
    window.sessionStorage.setItem(onboardingDraftKey, JSON.stringify({ profile: onboardingProfile, sessions, days, periods }));
  }, [screen, onboardingProfile, sessions, days, periods]);

  const publicScreens: AthleteScreen[] = ["welcome", "access", "login", "onboarding"];
  useEffect(() => {
    let cancelled = false;
    const sessionFrom = (payload: unknown) => {
      const withUser = payload as { user?: { role?: string; athleteId?: string; name?: string }; role?: string; athleteId?: string; name?: string };
      return { role: withUser?.user?.role ?? withUser?.role, athleteId: withUser?.user?.athleteId ?? withUser?.athleteId, name: withUser?.user?.name ?? withUser?.name };
    };
    void apiRequest("/api/v1/auth/me")
      .then((payload) => {
        if (cancelled) return;
        const session = sessionFrom(payload);
        if (session.role !== "athlete") {
          setAuthState("denied");
          if (publicScreens.includes(screen)) router.replace("/pt/coach/today");
          return;
        }
        if (!session.athleteId) {
          setAuthState("unlinked");
          return;
        }
        setAthleteId(session.athleteId);
        if (session.name) setAthleteName(session.name);
        setAuthState("signed-in");
        if (publicScreens.includes(screen) && screen !== "onboarding") router.replace("/pt/athlete/home");
      })
      .catch(() => {
        if (cancelled) return;
        setAuthState("signed-out");
        if (!publicScreens.includes(screen)) router.replace("/pt/athlete/login");
      });
    return () => { cancelled = true; };
  }, [screen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (screen !== "onboarding" || !inviteToken) {
      setInviteState("idle");
      return;
    }
    let cancelled = false;
    setInviteState("checking");
    setFeedback("");
    void apiRequest<{ athlete?: { name?: string }; email?: string }>(`/api/v1/invitations/${inviteToken}`)
      .then((invitation) => {
        if (cancelled) return;
        setOnboardingProfile((current) => ({
          ...current,
          fullName: invitation.athlete?.name ?? current.fullName,
          email: invitation.email ?? current.email,
        }));
        setInviteState("valid");
      })
      .catch((cause) => {
        if (cancelled) return;
        setInviteState("invalid");
        setFeedback(cause instanceof Error ? cause.message : "Convite inválido.");
      });
    return () => { cancelled = true; };
  }, [inviteToken, screen]);

  useEffect(() => {
    if (authState !== "signed-in" || publicScreens.includes(screen)) return;
    void loadAthleteData().catch((cause) => {
      setFeedback(cause instanceof Error ? cause.message : "Não foi possível carregar seus dados.");
    });
  }, [authState]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!publicScreens.includes(screen) && authState === "checking") {
    return <main className="athlete-phone light"><AthleteLoading label="Verificando sessão…" /></main>;
  }

  if (!publicScreens.includes(screen) && authState === "denied") {
    return <main className="athlete-phone light"><div className="athlete-role-gate"><div className="athlete-role-card"><ShieldCheck size={34} /><h1>Área do atleta</h1><p>A conta logada é da <strong>comissão técnica</strong> e não pode acessar o app do atleta. Use o painel do treinador.</p><AthleteButton onClick={() => window.location.assign("/pt/coach/today")}>Ir para o painel do treinador</AthleteButton></div></div></main>;
  }

  if (!publicScreens.includes(screen) && authState === "unlinked") {
    return <main className="athlete-phone light"><div className="athlete-role-gate"><div className="athlete-role-card"><ShieldCheck size={34} /><h1>Perfil não vinculado</h1><p>Sua conta ainda não está vinculada a um prontuário de atleta. Solicite o vínculo à comissão técnica.</p><AthleteButton onClick={() => void signOut()}>Sair da conta</AthleteButton></div></div></main>;
  }

  if (!publicScreens.includes(screen) && authState === "signed-out") {
    return <main className="athlete-phone light"><div className="athlete-role-gate"><div className="athlete-role-card"><LoaderCircle className="spin" size={30} /><h1>Redirecionando…</h1><p>Sessão expirada. Faça login para continuar.</p></div></div></main>;
  }

  const saveAthleteRecord = async (endpoint: string, payload: Record<string, unknown>, next: AthleteScreen) => {
    setSaving(true); setFeedback("");
    try {
      await apiRequest(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      await loadAthleteData();
      go(next);
    } catch (cause) { setFeedback(cause instanceof Error ? cause.message : "Não foi possível salvar."); }
    finally { setSaving(false); }
  };
  const voice = (target: (value: string) => void) => {
    type Recognition = { lang: string; start: () => void; onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onerror: () => void };
    const RecognitionCtor = (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
    if (!RecognitionCtor) { setFeedback("Ditado indisponível neste navegador. Você pode digitar normalmente."); return; }
    const recognition = new RecognitionCtor(); recognition.lang = "pt-BR";
    recognition.onresult = (event) => { target(event.results[0][0].transcript); setFeedback("Transcrição pronta. Revise antes de salvar."); };
    recognition.onerror = () => setFeedback("Não foi possível captar a voz. Tente novamente.");
    recognition.start(); setFeedback("Ouvindo...");
  };
  const login = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setFeedback("");
    try {
      const response = await apiRequest<{ user?: { role?: string; athleteId?: string; name?: string } }>("/api/v1/auth/login", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      if (response?.user && response.user.role !== "athlete") {
        setFeedback("Esta conta é da comissão técnica. Use o painel do treinador.");
        return;
      }
      if (!response.user?.athleteId) {
        setFeedback("A conta não possui um perfil de atleta vinculado.");
        return;
      }
      setAthleteId(response.user.athleteId);
      if (response.user?.name) setAthleteName(response.user.name);
      const pendingOnboarding = typeof window !== "undefined" ? window.sessionStorage.getItem("rkf_pending_onboarding") : null;
      if (pendingOnboarding) {
        const profile = JSON.parse(pendingOnboarding) as Record<string, unknown>;
        await apiRequest("/api/v1/athlete/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile) });
        window.sessionStorage.removeItem("rkf_pending_onboarding");
        window.sessionStorage.removeItem(onboardingDraftKey);
      }
      const data = await loadAthleteData();
      go(data.checkIn ? "home" : "checkin");
    } catch (cause) { setFeedback(cause instanceof Error ? cause.message : "Não foi possível entrar."); }
    finally { setSaving(false); }
  };

  const signOut = async () => {
    setSaving(true); setFeedback("");
    try { await apiRequest("/api/v1/auth/logout", { method: "POST" }); }
    catch { /* a sessão já pode ter expirado; o cookie local ainda deve ser removido pelo próximo login */ }
    finally { setAuthState("signed-out"); setAppData(null); setEmail(""); setPassword(""); setSaving(false); router.replace("/pt/athlete/login"); }
  };
  const finishOnboarding = async () => {
    if (!onboardingProfile.medicalAccepted || !onboardingProfile.responsibilityAccepted) { setFeedback("Aceite os termos de saúde e responsabilidade para continuar."); return; }
    setSaving(true); setFeedback("");
    const acceptedAt = new Date().toISOString();
    const payload = { name:onboardingProfile.fullName, birthDate:onboardingProfile.birthDate, sex:onboardingProfile.sex, category:onboardingProfile.category, events:onboardingProfile.events, otherEvent:onboardingProfile.otherEvent, level:onboardingProfile.level, club:onboardingProfile.club, targetMeet:onboardingProfile.targetMeet, meetDate:onboardingProfile.meetDate, primaryEvent:onboardingProfile.primaryEvent, secondaryEvent:onboardingProfile.secondaryEvent, objective:onboardingProfile.objective, availability:{ sessionsPerWeek:sessions, days, periods }, consents:{ medical:{ acceptedAt, version:"2026-01", origin:"athlete-app:onboarding" }, responsibility:{ acceptedAt, version:"2026-01", origin:"athlete-app:onboarding" } }, onboardingStatus:"completed", status:"active" };
    try {
      if (inviteToken) {
        if (inviteState !== "valid") { setFeedback("Valide o convite antes de continuar."); return; }
        if (!onboardingProfile.email.trim() || onboardingProfile.password.length < 8) { setFeedback("Informe o e-mail do convite e uma senha com ao menos 8 caracteres."); return; }
        const accepted = await apiRequest<{ user?: { athleteId?: string } }>(`/api/v1/invitations/${inviteToken}/accept`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ password:onboardingProfile.password, name:onboardingProfile.fullName, profile:payload }) });
        if (!accepted.user?.athleteId) throw new Error("A conta criada não possui atleta vinculado.");
        setAthleteId(accepted.user.athleteId);
        setInviteToken("");
        window.sessionStorage.removeItem(onboardingDraftKey);
        go("checkin");
      } else if (authState === "signed-in") {
        await apiRequest("/api/v1/athlete/profile", { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload) });
        await apiRequest("/api/v1/manage/activities", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ type:"planning-created", athleteId, athlete:onboardingProfile.fullName, plan:payload, status:"active" }) });
        window.sessionStorage.removeItem(onboardingDraftKey);
        go("checkin");
      } else {
        window.sessionStorage.setItem("rkf_pending_onboarding", JSON.stringify(payload));
        go("login");
      }
    } catch (cause) { setFeedback(cause instanceof Error ? cause.message : "Não foi possível criar o planejamento."); }
    finally { setSaving(false); }
  };

  const validateOnboardingStep = (step: number) => {
    const errors: Partial<Record<number, string>> = {
      1: !onboardingProfile.fullName.trim() || !onboardingProfile.birthDate || !onboardingProfile.sex
        ? "Preencha nome, data de nascimento e sexo para continuar."
        : inviteToken && (!onboardingProfile.email.trim() || onboardingProfile.password.length < 8)
          ? "Confirme o e-mail do convite e crie uma senha com ao menos 8 caracteres."
          : "",
      2: onboardingProfile.events.length === 0 || !onboardingProfile.level
        ? "Selecione ao menos uma prova principal e seu nível atual."
        : "",
      3: !onboardingProfile.targetMeet || !onboardingProfile.meetDate || !onboardingProfile.primaryEvent || !onboardingProfile.objective
        ? "Complete a competição-alvo, data, prova principal e objetivo."
        : "",
      4: days.length === 0 || periods.length === 0
        ? "Selecione ao menos um dia e um período disponíveis."
        : "",
      5: !onboardingProfile.medicalAccepted || !onboardingProfile.responsibilityAccepted
        ? "Aceite os termos de saúde e responsabilidade para continuar."
        : "",
    };
    const error = errors[step];
    if (error) {
      setFeedback(error);
      return false;
    }
    setFeedback("");
    return true;
  };

  if (screen === "welcome") return <main className="athlete-auth-shell dark"><div className="athlete-watermark" /><div className="athlete-auth-center"><AthleteMark /><p>Treinos inteligentes.<br />Performance real.<br />Resultados consistentes.</p></div><div className="athlete-auth-actions"><AthleteButton onClick={() => go("access")}>Entrar no app</AthleteButton></div></main>;

  if (screen === "access") return <main className="athlete-auth-shell dark"><div className="athlete-access"><AthleteMark /><h1>Você já é<br />atleta da seleção?</h1><p>Para continuarmos, escolha uma das opções abaixo.</p></div><div className="athlete-auth-actions"><AthleteButton onClick={() => go("login")}><b>Já sou atleta</b><small>Entrar na minha conta</small></AthleteButton><AthleteButton secondary onClick={() => go("onboarding", 1)}><b>Primeiro acesso</b><small>Criar meu perfil e planejamento</small></AthleteButton></div></main>;

  if (screen === "login") return <main className="athlete-phone light"><AppHeader onBack={() => go("access")} /><form className="athlete-form auth-form" onSubmit={(event) => void login(event)}><div className="athlete-form-intro"><span>Área do atleta</span><h1>Entrar na<br />sua conta</h1><p>Acesse seu treino, prontidão e evolução.</p></div><Field label="E-mail ou CPF"><input required autoComplete="username" value={email} onChange={(event)=>setEmail(event.target.value)} placeholder="Digite seu e-mail ou CPF" /></Field><Field label="Senha"><div className="password-field"><input required autoComplete="current-password" value={password} onChange={(event)=>setPassword(event.target.value)} type={showPassword ? "text" : "password"} placeholder="Digite sua senha" /><button type="button" aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} onClick={()=>setShowPassword((current)=>!current)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></Field>{feedback&&<p className="athlete-feedback" role="alert">{feedback}</p>}<AthleteButton type="submit" disabled={saving}>{saving?"Entrando...":"Entrar"}</AthleteButton><p className="athlete-account-copy">Recebeu um convite? <button type="button" onClick={() => go("onboarding",1)}>Fazer primeiro acesso</button></p></form></main>;

  if (screen === "onboarding") return <main className="athlete-phone light"><AppHeader onBack={() => onboardingStep > 1 ? go("onboarding", onboardingStep - 1) : go("access")} /><section className="athlete-onboarding"><div className="onboarding-progress" aria-label={`Etapa ${onboardingStep} de 6`}>{[1,2,3,4,5,6].map((step) => <i className={step <= onboardingStep ? "active" : ""} key={step}>{step < onboardingStep ? <Check size={10} /> : step}</i>)}</div>{inviteState === "checking" ? <p className="athlete-invite-state"><LoaderCircle className="spin" size={15}/>Validando convite…</p> : null}{inviteState === "valid" ? <p className="athlete-invite-state valid"><Check size={15}/>Convite validado. Complete seu perfil.</p> : null}<OnboardingStep step={onboardingStep} invite={Boolean(inviteToken)} sessions={sessions} setSessions={setSessions} days={days} setDays={setDays} periods={periods} setPeriods={setPeriods} profile={onboardingProfile} setProfile={setOnboardingProfile} />{feedback&&<p className="athlete-feedback" role="alert">{feedback}</p>}<div className="onboarding-action">{onboardingStep < 6 ? <AthleteButton disabled={inviteState === "checking" || inviteState === "invalid"} onClick={() => { if (validateOnboardingStep(onboardingStep)) go("onboarding", onboardingStep + 1); }}>Continuar</AthleteButton> : <AthleteButton disabled={saving || inviteState === "checking" || inviteState === "invalid"} onClick={() => void finishOnboarding()}>{saving?"Criando planejamento...":"Criar meu planejamento"}</AthleteButton>}</div></section></main>;

  if (!appData) return <main className="athlete-phone light">{appLoading ? <AthleteLoading /> : <AthleteState title="Não foi possível carregar seu app" description={feedback || "Verifique sua conexão e tente novamente."} action={<AthleteButton onClick={() => void loadAthleteData()}>Tentar novamente</AthleteButton>} />}</main>;

  if (screen === "checkin") return <main className="athlete-phone light"><AppHeader onBack={() => go("home")} title="Check-in" /><CheckInScreen data={appData} firstName={athleteFirstName} voice={voice} feedback={feedback} saving={saving} onSave={(payload) => void saveAthleteRecord("/api/v1/athlete/check-in", payload, "home")} /></main>;

  const session = appData.today.session;
  const selectedMeet = appData.competitions.find((meet) => meet.id === selectedMeetId) ?? appData.competitions.find((meet) => meet.target) ?? appData.competitions[0];
  return <main className="athlete-phone athlete-main-app"><AppHeader onBack={screen === "home" ? undefined : () => go("home")} title={screenTitle(screen)} /><div className="athlete-screen-content">{screen === "home" && <AthleteHome data={appData} go={go} />}{screen === "session" && <AthleteSessionView data={appData} go={go} voice={voice} feedback={feedback} />}{screen === "results" && (session ? <ResultsForm session={session} voice={voice} feedback={feedback} saving={saving} onSave={(payload)=>void saveAthleteRecord("/api/v1/athlete/results",payload,"checkout")} /> : <AthleteState title="Sem sessão para registrar" description="Aguarde a publicação da sua prescrição." />)}{screen === "checkout" && (session ? <CheckoutForm session={session} voice={voice} feedback={feedback} saving={saving} onSave={(payload)=>void saveAthleteRecord("/api/v1/athlete/checkout",payload,"home")} /> : <AthleteState title="Sem sessão para concluir" description="Aguarde a publicação da sua prescrição." />)}{screen === "week" && <WeekView data={appData} go={go} />}{screen === "phase" && <PhaseView data={appData} />}{screen === "competitions" && <Competitions data={appData} onResult={(meetId) => { setSelectedMeetId(meetId); go("competition-result"); }} />}{screen === "competition-result" && <CompetitionResult meet={selectedMeet} feedback={feedback} saving={saving} onSave={(payload)=>void saveAthleteRecord("/api/v1/athlete/results",payload,"competitions")} />}{screen === "more" && <MoreView data={appData} go={go} onSignOut={() => void signOut()} />}</div><BottomNav active={screen} go={go} /></main>;
}

function OnboardingStep({ step, invite, sessions, setSessions, days, setDays, periods, setPeriods, profile, setProfile }: { step: number; invite:boolean; sessions: number; setSessions: (value:number)=>void; days:string[]; setDays:(value:string[])=>void; periods:string[]; setPeriods:(value:string[])=>void; profile:OnboardingProfile; setProfile:(value:OnboardingProfile)=>void }) {
  const headers = [["Dados pessoais","Vamos começar com seus dados básicos."],["Perfil esportivo","Conte mais sobre sua trajetória na natação."],["Macrociclo","Qual é sua competição-alvo?"],["Disponibilidade","Quantas sessões você consegue fazer por semana?"],["Termo e saúde","Leia e aceite para continuarmos."],["Criar planejamento","Tudo pronto! Vamos criar seu planejamento."]];
  const [title,subtitle]=headers[step-1];
  const update = <K extends keyof OnboardingProfile>(key:K,value:OnboardingProfile[K]) => setProfile({...profile,[key]:value});
  return <div className="onboarding-step"><h1>{title}</h1><p>{subtitle}</p>
     {step===1&&<div className="athlete-form compact-form"><Field label="Nome completo"><input required autoComplete="name" value={profile.fullName} onChange={event=>update("fullName",event.target.value)} placeholder="Como devemos chamar você?" /></Field>{invite&&<><Field label="E-mail do convite"><input type="email" readOnly value={profile.email} /></Field><Field label="Crie sua senha"><input type="password" autoComplete="new-password" minLength={8} value={profile.password} onChange={event=>update("password",event.target.value)} placeholder="Mínimo de 8 caracteres" /></Field></>}<Field label="Data de nascimento"><input required type="date" value={profile.birthDate} onChange={event=>update("birthDate",event.target.value)} /></Field><Field label="Sexo"><div className="segmented">{["Feminino","Masculino","Outro"].map(item=><button type="button" aria-label={item} key={item} className={profile.sex===item?"active":""} onClick={()=>update("sex",item)}>{item}</button>)}</div></Field><Field label="Categoria atual"><select value={profile.category} onChange={event=>update("category",event.target.value)}><option>Absoluto</option><option>Júnior</option><option>Juvenil</option><option>Infantil</option></select></Field></div>}
    {step===2&&<div className="athlete-form compact-form"><Field label="Provas principais"><div className="event-pills">{["50L","100L","200L","400L"].map(item=><button type="button" aria-label={item} key={item} className={profile.events.includes(item)?"active":""} onClick={()=>update("events",profile.events.includes(item)?profile.events.filter(event=>event!==item):[...profile.events,item])}>{item}</button>)}</div></Field><Field label="Outras provas"><select value={profile.otherEvent} onChange={event=>update("otherEvent",event.target.value)}><option value="">Selecione (opcional)</option><option>800 Livre</option><option>1500 Livre</option><option>200 Medley</option></select></Field><Field label="Nível atual"><select value={profile.level} onChange={event=>update("level",event.target.value)}><option>Seleção nacional</option><option>Nacional</option><option>Estadual</option></select></Field><Field label="Clube atual"><input value={profile.club} onChange={event=>update("club",event.target.value)} placeholder="Digite seu clube" /></Field></div>}
    {step===3&&<div className="athlete-form compact-form"><Field label="Competição-alvo"><select value={profile.targetMeet} onChange={event=>update("targetMeet",event.target.value)}><option value="">Selecione a competição</option><option>Campeonato Brasileiro</option><option>Troféu Brasil</option><option>Campeonato Estadual</option></select></Field><Field label="Data da competição"><input type="date" value={profile.meetDate} onChange={event=>update("meetDate",event.target.value)} /></Field><Field label="Prova principal"><select value={profile.primaryEvent} onChange={event=>update("primaryEvent",event.target.value)}><option value="">Selecione a prova</option><option>400 Livre</option><option>200 Livre</option><option>100 Livre</option><option>50 Livre</option></select></Field><Field label="Provas secundárias"><select value={profile.secondaryEvent} onChange={event=>update("secondaryEvent",event.target.value)}><option value="">Selecione (opcional)</option><option>200 Livre</option><option>800 Livre</option><option>100 Livre</option></select></Field><Field label="Objetivo"><select value={profile.objective} onChange={event=>update("objective",event.target.value)}><option value="">Selecione o objetivo</option><option>Índice internacional</option><option>Recorde pessoal</option><option>Final nacional</option></select></Field></div>}
    {step===4&&<div className="availability"><div className="session-stepper"><button type="button" aria-label="Diminuir sessões" onClick={()=>setSessions(Math.max(3,sessions-1))}><Minus size={17}/></button><strong>{sessions}</strong><button type="button" aria-label="Aumentar sessões" onClick={()=>setSessions(Math.min(10,sessions+1))}><Plus size={17}/></button></div><small>Mínimo 3 · Máximo 10</small><b>Dias disponíveis</b><div className="day-pills">{["SEG","TER","QUA","QUI","SEX","SÁB","DOM"].map(day=><button type="button" aria-label={day} className={days.includes(day)?"active":""} key={day} onClick={()=>setDays(days.includes(day)?days.filter(item=>item!==day):[...days,day])}>{day}</button>)}</div><b>Períodos disponíveis</b><div className="check-row">{["Manhã","Tarde","Noite"].map(period=><label key={period}><input type="checkbox" checked={periods.includes(period)} onChange={()=>setPeriods(periods.includes(period)?periods.filter(item=>item!==period):[...periods,period])}/>{period}</label>)}</div></div>}
    {step===5&&<div className="terms-list"><article><b>Atestado médico</b><p>Declaro estar apta e com atestado médico válido para a prática esportiva.</p><label><input type="checkbox" checked={profile.medicalAccepted} onChange={event=>update("medicalAccepted",event.target.checked)} />Li e aceito</label></article><article><b>Termo de responsabilidade</b><p>Estou ciente dos riscos inerentes ao esporte e da necessidade de informar qualquer alteração.</p><label><input type="checkbox" checked={profile.responsibilityAccepted} onChange={event=>update("responsibilityAccepted",event.target.checked)} />Li e aceito</label></article></div>}
    {step===6&&<div className="planning-ready"><div>{headers.slice(0,5).map(([item])=><p key={item}><Check size={15}/>{item}</p>)}</div><span>🎉</span></div>}
  </div>;
}

function screenTitle(screen: AthleteScreen) { const titles:Partial<Record<AthleteScreen,string>>={session:"Sessão de hoje",results:"Registrar resultados",checkout:"Fim do dia",week:"Semanal",phase:"Fase atual",competitions:"Competições",["competition-result"]:"Resultado",more:"Mais"}; return titles[screen]; }
