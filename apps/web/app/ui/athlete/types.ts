export type AthleteScreen =
  | "welcome"
  | "access"
  | "login"
  | "onboarding"
  | "checkin"
  | "home"
  | "session"
  | "results"
  | "checkout"
  | "week"
  | "phase"
  | "competitions"
  | "competition-result"
  | "more";

export type OnboardingProfile = {
  fullName: string;
  email: string;
  password: string;
  birthDate: string;
  sex: string;
  category: string;
  events: string[];
  otherEvent: string;
  level: string;
  club: string;
  targetMeet: string;
  meetDate: string;
  primaryEvent: string;
  secondaryEvent: string;
  objective: string;
  medicalAccepted: boolean;
  responsibilityAccepted: boolean;
};

export type AthleteSessionStep = {
  id: string;
  repetitions: number;
  distanceMeters?: number;
  durationSeconds?: number;
  stroke: string;
  target?: string;
  interval?: string;
  equipment: string[];
  notes?: string;
  kind: string;
};

export type AthleteSession = {
  id: string;
  prescriptionId?: string;
  title: string;
  objective: string;
  date: string;
  poolLengthM: number;
  volumeMeters: number;
  zone: string;
  expectedPse: number;
  blocks: Array<{
    id: string;
    title: string;
    repeatCount: number;
    volumeMeters: number;
    steps: AthleteSessionStep[];
  }>;
};

export type AthleteAppData = {
  generatedAt: string;
  date: string;
  athlete: {
    id: string;
    name?: string;
    email?: string;
    group?: string;
    category?: string;
    club?: string;
    level?: string;
    events: string[];
    primaryEvent?: string;
    secondaryEvent?: string;
    objective?: string;
    targetMeet?: string;
    meetDate?: string;
    availability?: { sessionsPerWeek?: number; days?: string[]; periods?: string[] };
    onboardingStatus?: string;
  };
  checkIn: {
    id: string;
    date: string;
    psr?: number;
    sleepHours?: number;
    fatigue?: number;
    soreness?: number;
    pain?: number;
    feelings?: string[];
    notes?: string;
  } | null;
  readiness: {
    score: number;
    psr: number | null;
    sleepHours: number | null;
    status: "updated" | "pending";
  };
  phase: {
    name: string;
    objective: string;
    currentWeek: number;
    totalWeeks: number;
    startsOn: string;
    endsOn: string;
    targetMeet: string | null;
  };
  today: {
    status: "check-in-pending" | "ready" | "completed";
    session: AthleteSession | null;
    execution: Record<string, unknown> | null;
  };
  week: {
    startsOn: string;
    endsOn: string;
    plannedMeters: number;
    completedMeters: number;
    plannedSessions: number;
    completedSessions: number;
    load: number;
    sessions: Array<{
      id: string;
      date: string;
      title?: string;
      volumeMeters: number;
      zone: string;
      completed: boolean;
    }>;
  };
  competitions: Array<{
    id: string;
    name?: string;
    startsOn?: string;
    endsOn?: string;
    priority?: string;
    pool?: string;
    status?: string;
    target: boolean;
  }>;
  recentResults: Array<Record<string, unknown>>;
  recentWorkouts: Array<Record<string, unknown>>;
  load: Array<Record<string, unknown>>;
};

export const defaultOnboardingProfile: OnboardingProfile = {
  fullName: "",
  email: "",
  password: "",
  birthDate: "",
  sex: "",
  category: "Absoluto",
  events: [],
  otherEvent: "",
  level: "Nacional",
  club: "",
  targetMeet: "",
  meetDate: "",
  primaryEvent: "",
  secondaryEvent: "",
  objective: "",
  medicalAccepted: false,
  responsibilityAccepted: false,
};

export const onboardingDraftKey = "rkf_onboarding_draft";

export function readOnboardingDraft(): {
  profile?: OnboardingProfile;
  sessions?: number;
  days?: string[];
  periods?: string[];
} | null {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(window.sessionStorage.getItem(onboardingDraftKey) ?? "null") as {
      profile?: OnboardingProfile;
      sessions?: number;
      days?: string[];
      periods?: string[];
    } | null;
  } catch {
    return null;
  }
}

export function routeFor(screen: AthleteScreen, step?: number) {
  if (screen === "onboarding") return `/pt/athlete/onboarding/${step ?? 1}`;
  return `/pt/athlete/${screen}`;
}

export function screenFromPath(pathname: string): AthleteScreen {
  const value = pathname.split("/pt/athlete/")[1]?.split("/")[0];
  const screens: AthleteScreen[] = [
    "welcome",
    "access",
    "login",
    "onboarding",
    "checkin",
    "home",
    "session",
    "results",
    "checkout",
    "week",
    "phase",
    "competitions",
    "competition-result",
    "more",
  ];
  return screens.includes(value as AthleteScreen) ? value as AthleteScreen : "welcome";
}
