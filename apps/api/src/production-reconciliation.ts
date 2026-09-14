import type { ManagedStore } from "./managed-store.js";

const normalize = (value: unknown) => String(value ?? "")
  .trim()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase();

/**
 * Repairs legacy production snapshots where an athlete login survived but the
 * linked athlete profile did not. No sport/performance value is inferred.
 * Missing fields remain absent/UNKNOWN and can be completed by the athlete or
 * coach later.
 */
export function reconcileProductionAthleteProfiles(store: ManagedStore) {
  if (process.env.NODE_ENV !== "production") return { relinked: 0, created: 0, ambiguous: 0 };

  let relinked = 0;
  let created = 0;
  let ambiguous = 0;
  const users = store.list("users").filter((row) => row.role === "athlete");

  for (const user of users) {
    const organizationId = String(user.organizationId ?? "org-demo");
    const athleteId = typeof user.athleteId === "string" && user.athleteId.trim() ? user.athleteId.trim() : undefined;
    const scoped = store.list("athletes").filter((row) => String(row.organizationId ?? "org-demo") === organizationId);

    if (athleteId && scoped.some((row) => row.id === athleteId)) continue;

    const email = normalize(user.email);
    const name = normalize(user.name);
    const candidates = scoped.filter((row) =>
      Boolean((email && normalize(row.email) === email) || (name && normalize(row.name) === name)));

    if (candidates.length === 1) {
      store.update("users", user.id, { athleteId: candidates[0].id }, "update");
      relinked += 1;
      continue;
    }

    if (candidates.length > 1) {
      ambiguous += 1;
      continue;
    }

    if (athleteId) {
      store.create("athletes", {
        id: athleteId,
        organizationId,
        name: String(user.name ?? "Atleta"),
        ...(typeof user.email === "string" ? { email: user.email } : {}),
        status: "active",
        onboardingStatus: "profile_pending",
        profileCompleteness: "INCOMPLETE",
        dataQuality: "UNKNOWN_FIELDS_PRESERVED",
        source: "production-account-reconciliation",
      }, "create");
      created += 1;
    }
  }

  return { relinked, created, ambiguous };
}
