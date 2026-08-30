"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity, ArrowLeft, CalendarDays, Check, ChevronRight, CircleUserRound,
  ClipboardCheck, Clock3, Dumbbell, Eye, Flag, Gauge, Headphones, HeartPulse,
  HelpCircle, History, Home, ListChecks, LockKeyhole, LoaderCircle, Medal, Menu, Mic,
  Minus, Moon, Plus, Settings, ShieldCheck, Sparkles, Target, Trophy, UserRound,
  Waves,
} from "lucide-react";
import { apiRequest } from "./api";

type AthleteScreen = "welcome" | "access" | "login" | "onboarding" | "checkin" | "home" | "session" | "results" | "checkout" | "week" | "competitions" | "competition-result" | "more";
type OnboardingProfile = { fullName:string; birthDate:string; sex:string; category:string; events:string[]; otherEvent:string; level:string; club:string; targetMeet:string; meetDate:string; primaryEvent:string; secondaryEvent:string; objective:string; medicalAccepted:boolean; responsibilityAccepted:boolean };

const sessionBlocks = [
  { code: "AQ", tone: "blue", title: "Aquecimento", volume: "1.000 m", detail: "400 livre A1 · 200 educativo · 200 MI técnico · 4x50 progressivos" },
  { code: "PN", tone: "yellow", title: "Perna", volume: "600 m", detail: "12x50 @1:15 | A1/A2 | progressão técnica" },
  { code: "BR", tone: "green", title: "Braço", volume: "600 m", detail: "12x50 pull @0:50 | A1/A2 | variações" },
  { code: "PS", tone: "navy", title: "Pré-série", volume: "600 m", detail: "12x50 @0:55 | educativos e preparação em A2" },
  { code: "SP", tone: "yellow", title: "Série principal", volume: "2.800 m", detail: "14x200 A2 @3:05 | estável, descendente e sustentação técnica" },
  { code: "RG", tone: "green", title: "Regenerativo", volume: "400 m", detail: "100 costas · 200 livre A1 · 100 escolha" },
];

const menuItems = [
  [CircleUserRound, "Perfil do atleta"], [CalendarDays, "Disponibilidade semanal"],
  [History, "Histórico de treinos"], [Gauge, "Controle de carga"],
  [Trophy, "Competições do macrociclo"], [ShieldCheck, "Termos e saúde"],
  [Settings, "Configurações"], [HelpCircle, "Ajuda e suporte"],
] as const;

function routeFor(screen: AthleteScreen, step?: number) {
  if (screen === "onboarding") return `/pt/athlete/onboarding/${step ?? 1}`;
  return `/pt/athlete/${screen}`;
}

function screenFromPath(pathname: string): AthleteScreen {
  const value = pathname.split("/pt/athlete/")[1]?.split("/")[0];
  if (["welcome", "access", "login", "onboarding", "checkin", "home", "session", "results", "checkout", "week", "competitions", "competition-result", "more"].includes(value)) return value as AthleteScreen;
  return "welcome";
}

function AthleteMark({ compact = false }: { compact?: boolean }) {
  return <div className={`athlete-mark ${compact ? "compact" : ""}`}><span><Waves size={compact ? 25 : 55} strokeWidth={1.7} /><i /><i /><i /></span>{!compact && <strong>AQUA ELITE</strong>}</div>;
}

function PhoneStatus() {
  return <div className="athlete-status"><span>9:41</span><div><Activity size={11} /><Waves size={11} /><strong>●</strong></div></div>;
}

function AppHeader({ title, onBack, right }: { title?: string; onBack?: () => void; right?: ReactNode }) {
  return <><PhoneStatus /><header className="athlete-app-head">{onBack ? <button aria-label="Voltar" onClick={onBack}><ArrowLeft size={20} /></button> : <span />} {title ? <strong>{title}</strong> : <AthleteMark compact />}<div>{right}</div></header></>;
}

function BottomNav({ active, go }: { active: AthleteScreen; go: (screen: AthleteScreen) => void }) {
  const items: { screen: AthleteScreen; label: string; icon: typeof Home }[] = [
    { screen: "home", label: "Hoje", icon: Home }, { screen: "week", label: "Semanal", icon: CalendarDays },
    { screen: "session", label: "Fase", icon: Waves }, { screen: "competitions", label: "Competições", icon: Trophy },
    { screen: "more", label: "Mais", icon: Menu },
  ];
  return <nav className="athlete-bottom-nav">{items.map(({ screen, label, icon: Icon }) => <button key={screen} className={active === screen ? "active" : ""} onClick={() => go(screen)}><Icon size={19} /><span>{label}</span></button>)}</nav>;
}

function Rating({ value, onChange, values = [2, 4, 6, 8, 10] }: { value: number; onChange: (value: number) => void; values?: number[] }) {
  return <div className="athlete-rating">{values.map((item) => <button type="button" className={value === item ? "active" : ""} key={item} onClick={() => onChange(item)}>{item}</button>)}</div>;
}

function AthleteButton({ children, secondary = false, onClick, type = "button", disabled = false }: { children: ReactNode; secondary?: boolean; onClick?: () => void; type?: "button" | "submit"; disabled?: boolean }) {
  return <button type={type} disabled={disabled} onClick={onClick} className={`athlete-primary ${secondary ? "secondary" : ""}`}>{children}</button>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="athlete-field"><span>{label}</span>{children}</label>;
}

export default function AthleteApp() {
  const pathname = usePathname();
  const router = useRouter();
  const screen = screenFromPath(pathname);
  const onboardingStep = screen === "onboarding" ? Math.max(1, Math.min(6, Number(pathname.split("/").pop()) || 1)) : 1;
  const [psr, setPsr] = useState(8);
  const [pse, setPse] = useState(7);
  const [feelings, setFeelings] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [sessions, setSessions] = useState(8);
  const [days, setDays] = useState(["SEG", "TER", "QUA", "QUI", "SEX"]);
  const [periods, setPeriods] = useState(["Manhã", "Tarde"]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authState, setAuthState] = useState<"checking" | "signed-out" | "signed-in" | "denied">("checking");
  const [onboardingProfile, setOnboardingProfile] = useState<OnboardingProfile>({ fullName:"Ana Souza", birthDate:"2002-04-18", sex:"Feminino", category:"Absoluto", events:["200L","400L"], otherEvent:"", level:"Seleção nacional", club:"", targetMeet:"Campeonato Brasileiro", meetDate:"2026-09-20", primaryEvent:"400 Livre", secondaryEvent:"200 Livre", objective:"Índice internacional", medicalAccepted:true, responsibilityAccepted:true });
  const go = (next: AthleteScreen, step?: number) => router.push(routeFor(next, step));

  // Gate de autenticação: telas internas exigem sessão válida do atleta.
  // Telas públicas: welcome, access, login, onboarding (primeiro acesso).
  const publicScreens: AthleteScreen[] = ["welcome", "access", "login", "onboarding"];
  useEffect(() => {
    if (publicScreens.includes(screen)) return;
    let cancelled = false;
    const roleFrom = (payload: unknown) => {
      const withUser = payload as { user?: { role?: string }; role?: string };
      return withUser?.user?.role ?? withUser?.role;
    };
    void apiRequest("/api/v1/auth/me")
      .then((payload) => { if (!cancelled) setAuthState(roleFrom(payload) === "athlete" ? "signed-in" : "denied"); })
      .catch(() => {
        if (cancelled) return;
        if (process.env.NODE_ENV !== "production") {
          void apiRequest("/api/v1/auth/login", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "ana@natacao.local", password: "natacao-demo" }) })
            .then(() => { if (!cancelled) setAuthState("signed-in"); })
            .catch(() => { if (!cancelled) { setAuthState("signed-out"); router.replace("/pt/athlete/login"); } });
        } else { setAuthState("signed-out"); router.replace("/pt/athlete/login"); }
      });
    return () => { cancelled = true; };
  }, [screen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!publicScreens.includes(screen) && authState === "checking") {
    return <main className="athlete-phone light"><PhoneStatus /><div className="athlete-auth-loading"><LoaderCircle className="spin" size={26} /><span>Verificando sessão…</span></div></main>;
  }

  if (!publicScreens.includes(screen) && authState === "denied") {
    return <main className="athlete-phone light"><PhoneStatus /><div className="athlete-role-gate"><div className="athlete-role-card"><ShieldCheck size={34} /><h1>Área do atleta</h1><p>A conta logada é da <strong>comissão técnica</strong> e não pode acessar o app do atleta. Use o painel do treinador.</p><AthleteButton onClick={() => window.location.assign("/pt/coach/today")}>Ir para o painel do treinador</AthleteButton></div></div></main>;
  }

  if (!publicScreens.includes(screen) && authState === "signed-out") {
    return <main className="athlete-phone light"><PhoneStatus /><div className="athlete-role-gate"><div className="athlete-role-card"><LoaderCircle className="spin" size={30} /><h1>Redirecionando…</h1><p>Sessão expirada. Faça login para continuar.</p></div></div></main>;
  }

  const toggle = (value: string, current: string[], update: (next: string[]) => void) => update(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  const saveRecord = async (type: string, payload: Record<string, unknown>, next: AthleteScreen) => {
    setSaving(true); setFeedback("");
    try {
      const now = new Date();
      const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
      const json = (body: Record<string, unknown>) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const completedBody = {
        athleteId: "ath-ana", startedAt: new Date(now.getTime() - 6_000_000).toISOString(), endedAt: now.toISOString(),
        distanceMeters: Math.max(1, Number(payload.volumeMeters ?? 6000)), durationSeconds: 6000, completedSteps: 8, totalSteps: 8,
        rpe: Number(payload.pse ?? 6), source: "manual", externalId: `manual-ana-${localDate}`, rawPayload: payload,
      };
      if (type === "wellness") {
        const note = [String(payload.notes ?? "Check-in registrado pelo atleta"), Array.isArray(payload.feelings) && payload.feelings.length ? `Sinais: ${payload.feelings.join(", ")}` : ""].filter(Boolean).join(" | ");
        await apiRequest("/api/v1/wellness", json({
          athleteId: "ath-ana", date: localDate,
          fatigue: Math.max(0, 10 - Number(payload.psr ?? payload.pse ?? 8)),
          soreness: Number(payload.pain ?? 0), pain: Number(payload.pain ?? 0), note,
        }));
        if (payload.status === "checkout") {
          await apiRequest("/api/v1/completed-workouts", json(completedBody));
          await apiRequest("/api/v1/manage/activities", json({ type: "athlete-checkout", athleteId: "ana-souza", athlete: "Ana Souza", recordedAt: now.toISOString(), ...payload }));
        }
      } else if (type === "completed-workout") {
        await apiRequest("/api/v1/completed-workouts", json(completedBody));
        const seconds = (value: unknown) => { const [minutes, rest] = String(value ?? "0:00").split(":").map(Number); return Math.max(1, minutes * 60 + rest); };
        const average = seconds(payload.average); const best = seconds(payload.best); const last = seconds(payload.last);
        const repetitions = Array.from({ length: 12 }, (_, index) => ({ repetition: index + 1, distanceM: 200, timeSeconds: index === 0 ? best : index === 11 ? last : average, stroke: "livre", splits: [] }));
        await apiRequest("/api/v1/rkf/results/sessions", json({ athleteId: "ana-souza", date: localDate, event: "200 m Livre", poolLengthM: 50, sessionDistanceM: 6000, capturedDistanceM: 2400, durationMinutes: 100, pse: Number(payload.pse ?? 6), expectedPse: 6, prescribedVolumeM: 6000, sets: [{ set: 1, label: String(payload.series ?? "12x200 A2"), zone: "A2", repetitions }], notes: String(payload.notes ?? "") }));
      } else {
        await apiRequest("/api/v1/manage/activities", json({ type, athleteId: "ana-souza", athlete: "Ana Souza", recordedAt: now.toISOString(), ...payload }));
      }
      if (type === "completed-workout" || payload.status === "checkout") {
        await apiRequest("/api/v1/manage/activities", json({ type: "rkf-load-session", athleteId: "ana-souza", athlete: "Ana Souza", date: localDate, pse: Number(payload.pse ?? 6), expectedPse: 6, durationMinutes: 100, prescribedVolumeM: 6000, executedVolumeM: Number(payload.volumeMeters ?? 6000), source: "athlete-confirmed", status: "confirmed" }));
      }
      go(next);
    } catch (cause) { setFeedback(cause instanceof Error ? cause.message : "Não foi possível salvar."); }
    finally { setSaving(false); }
  };
  const voice = (target: (value: string) => void) => {
    type Recognition = { lang: string; start: () => void; onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onerror: () => void };
    const RecognitionCtor = (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
    if (!RecognitionCtor) { setFeedback("Ditado indisponível neste navegador. Você pode digitar normalmente."); return; }
    const recognition = new RecognitionCtor(); recognition.lang = "pt-BR";
    recognition.onresult = (event) => target(event.results[0][0].transcript);
    recognition.onerror = () => setFeedback("Não foi possível captar a voz. Tente novamente.");
    recognition.start(); setFeedback("Ouvindo...");
  };
  const login = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setFeedback("");
    try {
      const response = await apiRequest<{ user?: { role?: string } }>("/api/v1/auth/login", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      if (response?.user && response.user.role !== "athlete") {
        setFeedback("Esta conta é da comissão técnica. Use o painel do treinador.");
        return;
      }
      go("checkin");
    } catch (cause) { setFeedback(cause instanceof Error ? cause.message : "Não foi possível entrar."); }
    finally { setSaving(false); }
  };
  const finishOnboarding = async () => {
    if (!onboardingProfile.medicalAccepted || !onboardingProfile.responsibilityAccepted) { setFeedback("Aceite os termos de saúde e responsabilidade para continuar."); return; }
    setSaving(true); setFeedback("");
    const payload = { name:onboardingProfile.fullName, birthDate:onboardingProfile.birthDate, sex:onboardingProfile.sex, category:onboardingProfile.category, events:onboardingProfile.events, otherEvent:onboardingProfile.otherEvent, level:onboardingProfile.level, club:onboardingProfile.club, targetMeet:onboardingProfile.targetMeet, meetDate:onboardingProfile.meetDate, primaryEvent:onboardingProfile.primaryEvent, secondaryEvent:onboardingProfile.secondaryEvent, objective:onboardingProfile.objective, availability:{ sessionsPerWeek:sessions, days, periods }, onboardingStatus:"completed", status:"active" };
    try {
      await apiRequest("/api/v1/manage/athletes/ana-souza", { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload) });
      await apiRequest("/api/v1/manage/activities", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ type:"planning-created", athleteId:"ana-souza", athlete:onboardingProfile.fullName, plan:payload, status:"active" }) });
      go("checkin");
    } catch (cause) { setFeedback(cause instanceof Error ? cause.message : "Não foi possível criar o planejamento."); }
    finally { setSaving(false); }
  };

  if (screen === "welcome") return <main className="athlete-auth-shell dark"><PhoneStatus /><div className="athlete-watermark"><Waves /></div><div className="athlete-auth-center"><AthleteMark /><p>Treinos inteligentes.<br />Performance real.<br />Resultados consistentes.</p></div><div className="athlete-auth-actions"><AthleteButton onClick={() => go("access")}>Entrar no app</AthleteButton><AthleteButton secondary onClick={() => go("login")}>Saber mais</AthleteButton></div></main>;

  if (screen === "access") return <main className="athlete-auth-shell dark"><PhoneStatus /><div className="athlete-access"><AthleteMark /><h1>Você já é<br />atleta da seleção?</h1><p>Para continuarmos, escolha uma das opções abaixo.</p></div><div className="athlete-auth-actions"><AthleteButton onClick={() => go("login")}><b>Já sou atleta</b><small>Entrar na minha conta</small></AthleteButton><AthleteButton secondary onClick={() => go("onboarding", 1)}><b>Primeiro acesso</b><small>Criar meu perfil e planejamento</small></AthleteButton></div></main>;

  if (screen === "login") return <main className="athlete-phone light"><AppHeader onBack={() => go("access")} /><form className="athlete-form auth-form" onSubmit={(event) => void login(event)}><h1>Entrar na<br />sua conta</h1><Field label="E-mail ou CPF"><input required value={email} onChange={(event)=>setEmail(event.target.value)} placeholder="Digite seu e-mail ou CPF" /></Field><Field label="Senha"><div className="password-field"><input required value={password} onChange={(event)=>setPassword(event.target.value)} type="password" placeholder="Digite sua senha" /><Eye size={16} /></div></Field><button type="button" className="athlete-link" onClick={()=>setFeedback("Solicitação de recuperação preparada para o e-mail cadastrado.")}>Esqueci minha senha</button>{feedback&&<p className="athlete-feedback">{feedback}</p>}<AthleteButton type="submit" disabled={saving}>{saving?"Entrando...":"Entrar"}</AthleteButton><div className="athlete-separator"><span>ou continuar com</span></div><div className="social-login"><button type="button" onClick={()=>setFeedback("Login Google disponível após configurar o provedor OAuth.")}>G</button><button type="button" onClick={()=>setFeedback("Login Apple disponível após configurar o provedor OAuth.")}>●</button></div><p className="athlete-account-copy">Ainda não tem conta? <button type="button" onClick={() => go("onboarding",1)}>Primeiro acesso</button></p></form></main>;

  if (screen === "onboarding") return <main className="athlete-phone light"><AppHeader onBack={() => onboardingStep > 1 ? go("onboarding", onboardingStep - 1) : go("access")} /><section className="athlete-onboarding"><div className="onboarding-progress">{[1,2,3,4,5,6].map((step) => <i className={step <= onboardingStep ? "active" : ""} key={step}>{step < onboardingStep ? <Check size={10} /> : step}</i>)}</div><OnboardingStep step={onboardingStep} sessions={sessions} setSessions={setSessions} days={days} setDays={setDays} periods={periods} setPeriods={setPeriods} profile={onboardingProfile} setProfile={setOnboardingProfile} />{feedback&&<p className="athlete-feedback">{feedback}</p>}<div className="onboarding-action">{onboardingStep < 6 ? <AthleteButton onClick={() => go("onboarding", onboardingStep + 1)}>Continuar</AthleteButton> : <AthleteButton disabled={saving} onClick={() => void finishOnboarding()}>{saving?"Criando planejamento...":"Criar meu planejamento"}</AthleteButton>}</div></section></main>;

  if (screen === "checkin") return <main className="athlete-phone light"><AppHeader onBack={() => go("home")} /><form className="athlete-form checkin-form" onSubmit={(event) => { event.preventDefault(); void saveRecord("wellness", { psr, feelings, notes, status: "morning" }, "home"); }}><h1>Bom dia, Ana! <span>👋</span></h1><p>Como você acordou hoje?</p><section><b>PSR · Recuperação percebida</b><Rating value={psr} onChange={setPsr} /><div className="rating-legend"><span>Muito ruim</span><span>Excelente</span></div></section><section><b>Como você se sente? <small>(opcional)</small></b><div className="feeling-chips">{["Sono bom","Sono ruim","Corpo leve","Corpo pesado","Motivada","Cansada","Sem dor","Dor muscular"].map((item)=><button type="button" className={feelings.includes(item)?"active":""} key={item} onClick={()=>toggle(item,feelings,setFeelings)}>{item}</button>)}</div></section><AthleteButton secondary onClick={() => voice(setNotes)}><Mic size={18} />Falar por voz</AthleteButton><Field label="Observações (opcional)"><textarea value={notes} onChange={(event)=>setNotes(event.target.value)} maxLength={200} placeholder="Escreva ou fale sobre como você se sente..." /><small>{notes.length}/200</small></Field>{feedback && <p className="athlete-feedback">{feedback}</p>}<AthleteButton type="submit" disabled={saving}>{saving?"Salvando...":"Iniciar meu dia"}</AthleteButton></form></main>;

  return <main className="athlete-phone athlete-main-app"><AppHeader onBack={screen === "home" ? undefined : () => go("home")} title={screenTitle(screen)} /><div className="athlete-screen-content">{screen === "home" && <AthleteHome go={go} />}{screen === "session" && <AthleteSession go={go} voice={voice} feedback={feedback} />}{screen === "results" && <ResultsForm pse={pse} setPse={setPse} notes={notes} setNotes={setNotes} voice={voice} feedback={feedback} saving={saving} onSave={(payload)=>void saveRecord("completed-workout",payload,"home")} />}{screen === "checkout" && <Checkout pse={pse} setPse={setPse} notes={notes} setNotes={setNotes} voice={voice} feedback={feedback} saving={saving} onSave={(payload)=>void saveRecord("wellness",payload,"home")} />}{screen === "week" && <WeekView go={go} />}{screen === "competitions" && <Competitions go={go} />}{screen === "competition-result" && <CompetitionResult saving={saving} onSave={(payload)=>void saveRecord("race-result",payload,"competitions")} />}{screen === "more" && <MoreView go={go} />}</div><BottomNav active={screen} go={go} /></main>;
}

function OnboardingStep({ step, sessions, setSessions, days, setDays, periods, setPeriods, profile, setProfile }: { step: number; sessions: number; setSessions: (value:number)=>void; days:string[]; setDays:(value:string[])=>void; periods:string[]; setPeriods:(value:string[])=>void; profile:OnboardingProfile; setProfile:(value:OnboardingProfile)=>void }) {
  const headers = [["Dados pessoais","Vamos começar com seus dados básicos."],["Perfil esportivo","Conte mais sobre sua trajetória na natação."],["Macrociclo","Qual é sua competição-alvo?"],["Disponibilidade","Quantas sessões você consegue fazer por semana?"],["Termo e saúde","Leia e aceite para continuarmos."],["Criar planejamento","Tudo pronto! Vamos criar seu planejamento."]];
  const [title,subtitle]=headers[step-1];
  const update = <K extends keyof OnboardingProfile>(key:K,value:OnboardingProfile[K]) => setProfile({...profile,[key]:value});
  return <div className="onboarding-step"><h1>{title}</h1><p>{subtitle}</p>
    {step===1&&<div className="athlete-form compact-form"><Field label="Nome completo"><input value={profile.fullName} onChange={event=>update("fullName",event.target.value)} /></Field><Field label="Data de nascimento"><input type="date" value={profile.birthDate} onChange={event=>update("birthDate",event.target.value)} /></Field><Field label="Sexo"><div className="segmented">{["Feminino","Masculino"].map(item=><button type="button" key={item} className={profile.sex===item?"active":""} onClick={()=>update("sex",item)}>{item}</button>)}</div></Field><Field label="Categoria atual"><select value={profile.category} onChange={event=>update("category",event.target.value)}><option>Absoluto</option><option>Júnior</option><option>Juvenil</option></select></Field></div>}
    {step===2&&<div className="athlete-form compact-form"><Field label="Provas principais"><div className="event-pills">{["50L","100L","200L","400L"].map(item=><button type="button" key={item} className={profile.events.includes(item)?"active":""} onClick={()=>update("events",profile.events.includes(item)?profile.events.filter(event=>event!==item):[...profile.events,item])}>{item}</button>)}</div></Field><Field label="Outras provas"><select value={profile.otherEvent} onChange={event=>update("otherEvent",event.target.value)}><option value="">Selecione (opcional)</option><option>800 Livre</option></select></Field><Field label="Nível atual"><select value={profile.level} onChange={event=>update("level",event.target.value)}><option>Seleção nacional</option><option>Nacional</option><option>Estadual</option></select></Field><Field label="Clube atual"><input value={profile.club} onChange={event=>update("club",event.target.value)} placeholder="Digite seu clube" /></Field></div>}
    {step===3&&<div className="athlete-form compact-form"><Field label="Competição-alvo"><select value={profile.targetMeet} onChange={event=>update("targetMeet",event.target.value)}><option>Campeonato Brasileiro</option><option>Troféu Brasil</option></select></Field><Field label="Data da competição"><input type="date" value={profile.meetDate} onChange={event=>update("meetDate",event.target.value)} /></Field><Field label="Prova principal"><select value={profile.primaryEvent} onChange={event=>update("primaryEvent",event.target.value)}><option>400 Livre</option><option>200 Livre</option></select></Field><Field label="Provas secundárias"><select value={profile.secondaryEvent} onChange={event=>update("secondaryEvent",event.target.value)}><option>200 Livre</option><option>800 Livre</option></select></Field><Field label="Objetivo"><select value={profile.objective} onChange={event=>update("objective",event.target.value)}><option>Índice internacional</option><option>Recorde pessoal</option></select></Field></div>}
    {step===4&&<div className="availability"><div className="session-stepper"><button type="button" onClick={()=>setSessions(Math.max(3,sessions-1))}><Minus size={17}/></button><strong>{sessions}</strong><button type="button" onClick={()=>setSessions(Math.min(10,sessions+1))}><Plus size={17}/></button></div><small>Mínimo 3 · Máximo 10</small><b>Dias disponíveis</b><div className="day-pills">{["SEG","TER","QUA","QUI","SEX","SÁB","DOM"].map(day=><button type="button" className={days.includes(day)?"active":""} key={day} onClick={()=>setDays(days.includes(day)?days.filter(item=>item!==day):[...days,day])}>{day}</button>)}</div><b>Períodos disponíveis</b><div className="check-row">{["Manhã","Tarde","Noite"].map(period=><label key={period}><input type="checkbox" checked={periods.includes(period)} onChange={()=>setPeriods(periods.includes(period)?periods.filter(item=>item!==period):[...periods,period])}/>{period}</label>)}</div></div>}
    {step===5&&<div className="terms-list"><article><b>Atestado médico</b><p>Declaro estar apta e com atestado médico válido para a prática esportiva.</p><label><input type="checkbox" checked={profile.medicalAccepted} onChange={event=>update("medicalAccepted",event.target.checked)} />Li e aceito</label></article><article><b>Termo de responsabilidade</b><p>Estou ciente dos riscos inerentes ao esporte e da necessidade de informar qualquer alteração.</p><label><input type="checkbox" checked={profile.responsibilityAccepted} onChange={event=>update("responsibilityAccepted",event.target.checked)} />Li e aceito</label></article></div>}
    {step===6&&<div className="planning-ready"><div>{headers.slice(0,5).map(([item])=><p key={item}><Check size={15}/>{item}</p>)}</div><span>🎉</span></div>}
  </div>;
}

function AthleteHome({ go }: { go:(screen:AthleteScreen)=>void }) { return <><section className="athlete-home-title"><div><h1>Quarta-feira</h1><p>Semana 6 de 16</p></div><span>PSR <b>8/10</b></span></section><button className="athlete-session-hero" onClick={()=>go("session")}><small>Sessão de hoje</small><strong>A2 Steady State</strong><span>6.000 m · A2 2.400 m · PSE alvo 6</span><ChevronRight size={24}/></button><section className="athlete-summary-card"><h2>Resumo do dia</h2><p><Target size={16}/>Volume planejado <b>6.000 m</b></p><p><Waves size={16}/>Intensidade alvo <b>A2</b></p><p><Gauge size={16}/>PSE alvo <b>6</b></p></section><button className="athlete-last-workout" onClick={()=>go("results")}><div><small>Último treino</small><b>Segundo treino do dia</b><span>A1 · Técnica<br/>5.200 m · PSE 5</span></div><ChevronRight size={20}/></button><AthleteButton onClick={()=>go("session")}>Ver sessão completa</AthleteButton><AthleteButton secondary onClick={()=>go("results")}>Registrar tempos/resultados</AthleteButton></> }

function AthleteSession({ go, voice, feedback }: { go:(screen:AthleteScreen)=>void; voice:(target:(value:string)=>void)=>void; feedback:string }) { const [transcript,setTranscript]=useState(""); return <><section className="session-title"><h1>Sessão completa</h1><h2>A2 Steady State</h2><p>6.000 m · A2 2.400 m · PSE alvo 6</p></section><div className="session-block-list">{sessionBlocks.map(block=><article className={block.title==="Série principal"?"featured":""} key={block.code}><span className={block.tone}>{block.code}</span><div><b>{block.title}</b><p>{block.detail}</p></div><strong>{block.volume}</strong></article>)}</div>{transcript&&<p className="voice-transcript">{transcript}</p>}{feedback&&<p className="athlete-feedback">{feedback}</p>}<AthleteButton secondary onClick={()=>voice(setTranscript)}><Mic size={18}/>Registrar tempos por voz</AthleteButton><AthleteButton onClick={()=>go("results")}>Registrar resultados</AthleteButton><AthleteButton secondary onClick={()=>go("checkout")}>Finalizar sessão</AthleteButton></> }

function ResultsForm({ pse,setPse,notes,setNotes,voice,feedback,saving,onSave }: { pse:number;setPse:(n:number)=>void;notes:string;setNotes:(s:string)=>void;voice:(target:(value:string)=>void)=>void;feedback:string;saving:boolean;onSave:(payload:Record<string,unknown>)=>void }) { const [average,setAverage]=useState("2:08"); const [best,setBest]=useState("2:07"); return <form className="athlete-form results-form" onSubmit={(event)=>{event.preventDefault();onSave({series:"12x200 A2",average,best,last:"2:09",pse,notes,status:"completed"});}}><h1>Registrar resultados</h1><p>Série principal</p><AthleteButton secondary onClick={()=>voice(setNotes)}><Mic size={18}/>Falar resultados</AthleteButton><h2>Dados da série</h2><div className="result-rows"><label><span>Série</span><b>12x200 A2</b></label><label><span>Média</span><input value={average} onChange={event=>setAverage(event.target.value)}/></label><label><span>Melhor</span><input value={best} onChange={event=>setBest(event.target.value)}/></label><label><span>Último</span><b>2:09</b></label></div><section><b>PSE da série</b><Rating value={pse} onChange={setPse} values={[2,4,6,7,8,9,10]}/></section><Field label="Observações"><textarea value={notes} onChange={event=>setNotes(event.target.value)} maxLength={200} placeholder="Ex.: aumentei 2 braçadas nos últimos 50 m."/><small>{notes.length}/200</small></Field>{feedback&&<p className="athlete-feedback">{feedback}</p>}<AthleteButton type="submit" disabled={saving}>{saving?"Salvando...":"Salvar resultados"}</AthleteButton></form> }

function Checkout({ pse,setPse,notes,setNotes,voice,feedback,saving,onSave }: { pse:number;setPse:(n:number)=>void;notes:string;setNotes:(s:string)=>void;voice:(target:(value:string)=>void)=>void;feedback:string;saving:boolean;onSave:(payload:Record<string,unknown>)=>void }) { const [volume,setVolume]=useState("6000"); const [pain,setPain]=useState("1"); return <form className="athlete-form checkout-form" onSubmit={event=>{event.preventDefault();onSave({pse,volumeMeters:Number(volume),pain:Number(pain),notes,status:"checkout"});}}><h1>Fim do dia</h1><p>Como foi seu treino?</p><section><b>PSE final do dia</b><Rating value={pse} onChange={setPse}/><div className="rating-legend"><span>Muito leve</span><span>Muito difícil</span></div></section><Field label="Volume realizado"><div className="unit-field"><input value={volume} onChange={event=>setVolume(event.target.value)}/><span>m</span></div></Field><Field label="Nível de dor"><select value={pain} onChange={event=>setPain(event.target.value)}><option value="0">0 · Sem dor</option><option value="1">1 · Leve</option><option value="2">2 · Atenção</option><option value="3">3 · Limitante</option></select></Field><AthleteButton secondary onClick={()=>voice(setNotes)}><Mic size={18}/>Falar checkout</AthleteButton><Field label="Observações do dia"><textarea value={notes} onChange={event=>setNotes(event.target.value)} maxLength={200} placeholder="Treino completo. Braço pesado à tarde..."/><small>{notes.length}/200</small></Field>{feedback&&<p className="athlete-feedback">{feedback}</p>}<AthleteButton type="submit" disabled={saving}>{saving?"Salvando...":"Finalizar meu dia"}</AthleteButton></form> }

function WeekView({ go }: { go:(screen:AthleteScreen)=>void }) { return <><section className="athlete-home-title"><div><h1>Semana 6 de 16</h1><p>Visão geral</p></div></section><div className="week-stat-grid"><article><span>Planejado</span><b>48<small> km</small></b></article><article><span>Realizado</span><b>29<small> km</small></b></article><article><span>Sessões</span><b>5<small> / 8</small></b></article><article><span>Carga</span><b>420</b></article></div><section className="next-sessions"><h2>Próximas sessões</h2>{[["QUI AM","Técnica · A2","5.000 m"],["QUI PM","A3","6.200 m"],["SEX AM","Regenerativo","4.500 m"]].map(row=><button onClick={()=>go("session")} key={row[0]}><span>{row[0]}</span><b>{row[1]}</b><strong>{row[2]}</strong></button>)}</section><AthleteButton secondary onClick={()=>go("session")}>Ver macrociclo completo</AthleteButton></> }

function Competitions({ go }: { go:(screen:AthleteScreen)=>void }) { return <><section className="athlete-home-title"><div><h1>Competições</h1><p>Dentro do macrociclo</p></div></section><div className="athlete-meet-list"><article><header><div><b>Troféu Regional</b><span>Semana 8</span></div><em>Preparatória</em></header><AthleteButton secondary onClick={()=>go("competition-result")}>Inserir resultados</AthleteButton></article><article><header><div><b>Campeonato Brasileiro</b><span>Semana 16 · 20 a 24/09</span></div><em className="target">ALVO</em></header><AthleteButton secondary onClick={()=>go("competition-result")}>Inserir resultados</AthleteButton></article></div><AthleteButton secondary onClick={()=>go("competition-result")}><Plus size={17}/>Adicionar competição</AthleteButton></> }

function CompetitionResult({ saving,onSave }: { saving:boolean;onSave:(payload:Record<string,unknown>)=>void }) { const [event,setEvent]=useState("400 Livre"); const [time,setTime]=useState("3:51.20"); const [place,setPlace]=useState("2º"); const [kind,setKind]=useState("PB"); const [notes,setNotes]=useState(""); return <form className="athlete-form competition-form" onSubmit={e=>{e.preventDefault();onSave({event,time,place,kind,notes,meet:"Campeonato Brasileiro",status:"official"});}}><h1>Resultado da competição</h1><h2>Campeonato Brasileiro</h2><p>20 a 24/09 · Semana 16</p><Field label="Prova"><select value={event} onChange={e=>setEvent(e.target.value)}><option>400 Livre</option><option>200 Livre</option></select></Field><Field label="Tempo"><input value={time} onChange={e=>setTime(e.target.value)}/></Field><Field label="Colocação"><select value={place} onChange={e=>setPlace(e.target.value)}><option>1º</option><option>2º</option><option>3º</option></select></Field><Field label="Tipo de marca"><select value={kind} onChange={e=>setKind(e.target.value)}><option>PB</option><option>SB</option><option>Oficial</option></select></Field><Field label="Parciais / Observações"><textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="100 56.8 / 200 1:55.2 / 300 2:54.9..."/></Field><AthleteButton type="submit" disabled={saving}>{saving?"Salvando...":"Salvar resultado"}</AthleteButton></form> }

function MoreView({ go }: { go:(screen:AthleteScreen)=>void }) { const [selected,setSelected]=useState(""); const open=(label:string)=>{if(label.includes("Competições"))go("competitions");else if(label.includes("Histórico"))go("week");else setSelected(label);}; return <><section className="athlete-home-title"><div><h1>Mais</h1><p>Configurações e dados</p></div></section><div className="athlete-more-list">{menuItems.map(([Icon,label])=><button key={label} onClick={()=>open(label)}><Icon size={19}/><span>{label}</span><ChevronRight size={18}/></button>)}</div>{selected&&<section className="athlete-more-detail"><b>{selected}</b><p>Preferências e informações de {selected.toLowerCase()} disponíveis para consulta e atualização.</p><button onClick={()=>setSelected("")}>Concluir</button></section>}<button className="athlete-signout" onClick={()=>go("login")}><LockKeyhole size={17}/>Sair da conta</button><button className="coach-return" onClick={()=>window.location.assign("/pt/coach/today")}>Acessar área do treinador</button></> }

function screenTitle(screen: AthleteScreen) { const titles:Partial<Record<AthleteScreen,string>>={session:"Sessão de hoje",results:"Registrar resultados",checkout:"Fim do dia",week:"Semanal",competitions:"Competições",["competition-result"]:"Resultado",more:"Mais"}; return titles[screen]; }
