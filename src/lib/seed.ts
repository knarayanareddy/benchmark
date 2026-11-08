import { db, pool } from "@/db";
import * as s from "@/db/schema";
import { sql, count } from "drizzle-orm";
import riskData from "@/data/risks.json";
import { makeAlias } from "./identity";
import { LEVEL_PRIOR } from "./constants";
import { loadWorld } from "./world";
import { planDispatch } from "./dispatch";
import { seedSignals, seedEvolution } from "./seed3";

type RiskJson = (typeof riskData)[number];

let seeding: Promise<void> | null = null;
export function ensureSeeded(): Promise<void> {
  if (!seeding) {
    seeding = runSeed().catch((e) => {
      seeding = null;
      throw e;
    });
  }
  return seeding;
}

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const DAY = 24 * 3600 * 1000;

type Spec = {
  name: string;
  org: string;
  role: string;
  anon: string;
  countries: string[];
  themes: string[];
  arch: "ace" | "solid" | "partisan" | "rubber" | "fence" | "speeder" | "newbie";
  verified: boolean;
  stage?: boolean;
  cap?: number;
  coi?: boolean;
};

const SPECS: Spec[] = [
  { name: "Fatimé Abakar", org: "Lac Tchad Community Action", role: "local_ngo", anon: "alias", countries: ["Chad", "Niger"], themes: ["conflict", "displacement"], arch: "ace", verified: true },
  { name: "Idriss Mahamat", org: "Eastern Chad Early Warning Network", role: "aa_practitioner", anon: "sealed", countries: ["Chad"], themes: ["conflict", "food"], arch: "ace", verified: true },
  { name: "Dr. Claire Nguema", org: "Sahel Research Collective", role: "researcher", anon: "named", countries: ["Chad", "Mali", "Niger", "Nigeria"], themes: ["conflict", "political_economic"], arch: "solid", verified: true, stage: true },
  { name: "Moussa Traoré", org: "Mali Local Voices", role: "local_ngo", anon: "confidential", countries: ["Mali", "Niger"], themes: ["conflict", "food"], arch: "solid", verified: true },
  { name: "Aïcha Boukary", org: "Niger Food Watch", role: "aa_practitioner", anon: "alias", countries: ["Niger", "Nigeria", "Chad"], themes: ["food", "climate"], arch: "solid", verified: true },
  { name: "Samuel Eze", org: "Lagos Policy Lab", role: "researcher", anon: "confidential", countries: ["Nigeria", "Cameroon"], themes: ["political_economic", "conflict"], arch: "partisan", verified: true, coi: true },
  { name: "Halima Yusuf", org: "Sudan Civil Monitors", role: "local_ngo", anon: "sealed", countries: ["Sudan", "South Sudan"], themes: ["conflict", "displacement", "health"], arch: "ace", verified: true },
  { name: "Tewodros Bekele", org: "Horn Analytics", role: "conflict_analyst", anon: "named", countries: ["Ethiopia", "Somalia", "Kenya"], themes: ["conflict", "political_economic"], arch: "ace", verified: true, stage: true },
  { name: "Wanjiru Kamau", org: "Nairobi Anticipatory Action Hub", role: "aa_practitioner", anon: "alias", countries: ["Kenya", "Somalia", "Ethiopia"], themes: ["food", "climate"], arch: "solid", verified: true },
  { name: "Grace Akello", org: "Juba Peace Institute", role: "researcher", anon: "alias", countries: ["South Sudan", "Sudan", "Uganda"], themes: ["conflict", "displacement"], arch: "solid", verified: true },
  { name: "João Macamo", org: "Cabo Delgado Relief Partners", role: "local_ngo", anon: "confidential", countries: ["Mozambique", "Madagascar"], themes: ["climate", "conflict"], arch: "solid", verified: true },
  { name: "Rania Haddad", org: "Levant Early Warning", role: "conflict_analyst", anon: "alias", countries: ["Syria", "Lebanon", "Palestine"], themes: ["conflict", "political_economic"], arch: "ace", verified: true },
  { name: "Omar Al-Sayed", org: "Damascus Health Observatory", role: "un_ingo", anon: "sealed", countries: ["Syria"], themes: ["health", "displacement"], arch: "solid", verified: true },
  { name: "Layla Mansour", org: "Beirut Policy Forum", role: "researcher", anon: "named", countries: ["Lebanon", "Syria"], themes: ["political_economic", "conflict"], arch: "solid", verified: true, stage: true },
  { name: "Yusra Qasem", org: "Yemen Resilience Network", role: "local_ngo", anon: "sealed", countries: ["Yemen"], themes: ["food", "conflict"], arch: "ace", verified: true },
  { name: "Khaled Nasser", org: "Ground Notes Collective", role: "other", anon: "alias", countries: ["Palestine"], themes: ["conflict", "health"], arch: "partisan", verified: true, coi: true },
  { name: "Sher Ali Rahimi", org: "Kabul Field Observers", role: "local_ngo", anon: "sealed", countries: ["Afghanistan"], themes: ["displacement", "food", "conflict"], arch: "ace", verified: true },
  { name: "Dr. Nadia Karimi", org: "Central Asia Studies Group", role: "researcher", anon: "confidential", countries: ["Afghanistan", "Bangladesh"], themes: ["political_economic", "displacement"], arch: "solid", verified: true },
  { name: "Min Thu", org: "Rakhine Documentation Project", role: "local_ngo", anon: "sealed", countries: ["Myanmar"], themes: ["conflict", "displacement"], arch: "solid", verified: true },
  { name: "Maria Santos", org: "Mindanao Resilience Center", role: "aa_practitioner", anon: "named", countries: ["Philippines", "Indonesia"], themes: ["climate"], arch: "solid", verified: true, stage: true },
  { name: "Daniela Rojas", org: "Observatorio Colombia", role: "researcher", anon: "alias", countries: ["Colombia", "Venezuela"], themes: ["conflict", "displacement"], arch: "solid", verified: true },
  { name: "Pierre Dupont", org: "Regional MEAL Office, Nairobi", role: "un_ingo", anon: "confidential", countries: ["Sudan", "South Sudan", "Kenya", "Ethiopia", "Somalia"], themes: ["food", "displacement"], arch: "rubber", verified: true },
  { name: "Aisha Bello", org: "INGO Country Office", role: "un_ingo", anon: "alias", countries: ["Chad", "Nigeria"], themes: ["food", "political_economic"], arch: "rubber", verified: true },
  { name: "Jose Martín", org: "Regional Office, Amman", role: "un_ingo", anon: "confidential", countries: ["Syria", "Lebanon", "Yemen", "Iraq"], themes: ["political_economic", "conflict"], arch: "fence", verified: true },
  { name: "Tariq Aziz", org: "Independent", role: "other", anon: "alias", countries: ["Sudan", "Yemen", "Syria", "Afghanistan"], themes: ["conflict"], arch: "speeder", verified: false },
  { name: "Lea Moreau", org: "—", role: "other", anon: "alias", countries: ["Chad", "Mali"], themes: ["conflict"], arch: "fence", verified: false },
  { name: "Abdoulaye Sow", org: "Dakar Youth Observatory", role: "local_ngo", anon: "alias", countries: ["Mali", "Niger"], themes: ["conflict"], arch: "newbie", verified: false },
  { name: "Hawa Idris", org: "Darfur Community Network", role: "local_ngo", anon: "sealed", countries: ["Sudan"], themes: ["displacement", "food"], arch: "newbie", verified: true },
];

const VOUCHES: [number, number][] = [
  [3, 1], [2, 1], [3, 5], [3, 4], [8, 9], [8, 10], [7, 10], [12, 13], [12, 14], [14, 13], [17, 18], [2, 5], [7, 28 - 0],
  [21, 22], [15, 24], [8, 22], [12, 24], [20, 21],
];

const THEME_REASONS: Record<string, { up: string[]; down: string[]; same: string[] }> = {
  conflict: {
    up: [
      "Seeing more escalation on the ground than the analysis reflects — positions are being reinforced and local contacts expect further clashes.",
      "Local reporting suggests the trigger conditions are closer than the published rating implies.",
    ],
    down: [
      "Main actors still have strong incentives to avoid a full break. Incidents so far are localised and have not spread.",
      "The trigger needs more than isolated incidents; the enabling conditions are not in place locally yet.",
    ],
    same: ["Consistent with what contacts report locally.", "Pattern of incidents matches the analysis; no strong reason to move."],
  },
  food: {
    up: ["Market prices and early harvest signals are worse than the outlook assumes, and aid pipelines are thin.", "Coping capacity is already exhausted in the districts I follow."],
    down: ["Harvest outlook in the districts I follow is better than assumed, and cash assistance is still reaching households."],
    same: ["Matches seasonal monitoring I see."],
  },
  displacement: {
    up: ["Movement is already visible at crossing points and host communities are saturated.", "Returns are accelerating faster than reception capacity."],
    down: ["Flows have stabilised in recent weeks and authorities signal no new deadline."],
    same: ["Flow data I track is consistent with the analysis."],
  },
  health: {
    up: ["Surveillance gaps mean detection lags; case reports from clinics point to wider spread."],
    down: ["Vaccination and response capacity have improved since the last outbreak."],
    same: ["In line with clinic-level reporting."],
  },
  climate: {
    up: ["Seasonal forecasts and river levels point to a heavier season than assumed."],
    down: ["Preparedness investments make major impact less likely than the rating implies."],
    same: ["Forecasts I use agree with the analysis."],
  },
  political_economic: {
    up: ["Political calendar and fiscal stress make a shock more likely than assumed."],
    down: ["Elite bargains are holding; a sudden break looks less likely."],
    same: ["Consistent with the political calendar I follow."],
  },
};

function gauss(r: () => number) {
  return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
}

async function runSeed() {
  const client = await pool.connect();
  let didSeed = false;
  try {
    await client.query("select pg_advisory_lock(424242)");
    const [{ c }] = await db.select({ c: count() }).from(s.risks);
    if (Number(c) > 0) return;
    didSeed = true;
    await seedAll();
  } finally {
    await client.query("select pg_advisory_unlock(424242)").catch(() => {});
    client.release();
  }
  if (didSeed) await seedNotifications();
  await seedSignals();
  await seedEvolution();
}

async function chunked<T>(rows: T[], fn: (c: T[]) => Promise<unknown>, size = 200) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

async function seedAll() {
  const r = rng(20261106);
  const now = Date.now();
  const risks = riskData as RiskJson[];

  await chunked(risks, (c) =>
    db.insert(s.risks).values(
      c.map((x) => ({
        id: x.id,
        title: x.title,
        type: x.type,
        country: x.country,
        countries: x.countries,
        region: x.region,
        theme: x.theme,
        probability: x.probability,
        impact: x.impact,
        level: x.level,
        trend: (x as Record<string, unknown>).riskTrend ? String((x as Record<string, unknown>).riskTrend) : x.trend,
        status: x.status,
        rationale: x.rationale,
        rationaleUpdates: Array.isArray((x as Record<string, unknown>).rationaleUpdates)
          ? ((x as Record<string, unknown>).rationaleUpdates as Array<{ date: string | null; text: string }>)
          : [],
        sources: x.sources,
        exposure: x.exposure,
        expectedImpact: x.expectedImpact,
        materialised: x.materialised,
      }))
    )
  );
  const trigRows = risks.flatMap((x) =>
    x.triggers.map((t) => {
      const tr = t as Record<string, unknown>;
      return {
        id: `${x.id}-${t.id}`,
        riskId: x.id,
        title: t.title,
        description: t.description,
        completionHistory: Array.isArray(tr.completionHistory)
          ? (tr.completionHistory as Array<{ date: string; value: number }>)
          : [],
        trendHistory: Array.isArray(tr.trendHistory)
          ? (tr.trendHistory as Array<{ date: string; value: string }>)
          : [],
        dateEnteredISO: typeof tr.dateEnteredISO === "string" ? tr.dateEnteredISO : null,
        lastUpdateISO: typeof tr.lastUpdateISO === "string" ? tr.lastUpdateISO : null,
      };
    })
  );
  await chunked(trigRows, (c) => db.insert(s.triggers).values(c));

  // ---- experts (all SYNTHETIC) ----
  const mod = await db
    .insert(s.experts)
    .values({
      alias: "ACAPS Moderator",
      realName: "ACAPS Moderator (demo)",
      org: "ACAPS",
      roleType: "other",
      anonymity: "named",
      countries: [],
      themes: [],
      languages: ["en", "fr"],
      claims: [],
      verification: "verified",
      isModerator: true,
      archetype: "moderator",
    })
    .returning({ id: s.experts.id });
  const ids: number[] = [];
  for (let i = 0; i < SPECS.length; i++) {
    const sp = SPECS[i];
    const [row] = await db
      .insert(s.experts)
      .values({
        alias: makeAlias(i * 5 + 3),
        realName: sp.name,
        org: sp.org,
        roleType: sp.role,
        anonymity: sp.anon,
        stageOptIn: !!sp.stage,
        countries: sp.countries,
        themes: sp.themes,
        languages: ["Chad", "Niger", "Mali", "Syria", "Lebanon"].some((c) => sp.countries.includes(c)) ? ["en", "fr"] : ["en"],
        claims: [
          sp.role === "local_ngo" ? "Leads a local organisation in the country" : sp.role === "researcher" ? "Publishes on the country context" : "Works on early warning / anticipatory action",
          `${3 + Math.floor(r() * 14)} years on this context`,
        ],
        verification: sp.verified ? "verified" : "invited",
        invitedVia: i % 3 === 0 ? "moderator" : "peer vouch",
        weeklyCap: i % 4 === 0 ? 1 : 2,
        minMatch: 55,
        archetype: sp.arch,
      })
      .returning({ id: s.experts.id });
    ids.push(row.id);
  }
  void mod;
  await db.insert(s.vouches).values(
    VOUCHES.filter(([a, b]) => a <= ids.length && b <= ids.length && a !== b).map(([a, b]) => ({ voucherId: ids[a - 1], voucheeId: ids[b - 1] }))
  );
  await db.insert(s.invites).values([
    { code: "CHAD-7QX2", label: "Chad & Lake Chad Basin circle", countryHint: "Chad", issuedBy: "ACAPS moderator" },
    { code: "SAHEL-4KD9", label: "Sahel circle", countryHint: "Mali", issuedBy: "ACAPS moderator" },
    { code: "HORN-2MP8", label: "Sudan / Horn circle", countryHint: "Sudan", issuedBy: "ACAPS moderator" },
    { code: "LEVANT-9TR3", label: "Levant circle", countryHint: "Syria", issuedBy: "ACAPS moderator" },
    { code: "PEER-DEMO1", label: "Peer invitation from a verified circle member", countryHint: "Chad", issuedBy: `expert:${ids[2]}` },
  ]);

  // ---- questions ----
  const resolved = risks.filter((x) => x.status === "Materialised" || x.status === "Not materialised");
  const active = risks.filter((x) => x.status === "Active");
  const closes = new Date(now + 183 * DAY);
  const histQ = await db
    .insert(s.questions)
    .values(
      resolved.map((x) => ({
        riskId: x.id,
        text: `Season 1 (synthetic history): will this risk materialise? “${x.title}”`,
        criteria: "Resolved by ACAPS when the risk was marked Materialised or Not materialised.",
        season: "S1",
        status: "resolved",
        outcome: x.status === "Materialised" ? "yes" : "no",
        opensAt: new Date(now - 400 * DAY),
        closesAt: new Date(now - 30 * DAY),
      }))
    )
    .returning({ id: s.questions.id, riskId: s.questions.riskId });
  const hq = new Map(histQ.map((q) => [q.riskId, q.id]));

  const criteriaRisk =
    "YES if ACAPS marks this risk as Materialised (hazard or impact) by the close date, using the same evidence standard as the Risk Radar. If ACAPS cannot observe it, it is recorded as ‘unobservable’ and excluded from scoring — never counted as a miss.";
  const curRiskQ = await db
    .insert(s.questions)
    .values(
      active.map((x) => ({
        riskId: x.id,
        text: `Within the next 6 months, will this risk materialise: “${x.title}”?`,
        criteria: criteriaRisk,
        closesAt: closes,
        opensAt: new Date(now - 2 * DAY),
      }))
    )
    .returning({ id: s.questions.id, riskId: s.questions.riskId });
  const trigQrows = active
    .filter((x) => x.triggers.length)
    .map((x) => ({
      riskId: x.id,
      triggerId: `${x.id}-${x.triggers[0].id}`,
      text: `Within the next 6 months, will this ACAPS trigger occur: “${x.triggers[0].title}”?`,
      criteria:
        "YES if credible public reporting (e.g. ACLED, OCHA, ReliefWeb) confirms the trigger condition occurred inside the window. The ACAPS analyst makes the call; ‘unobservable’ is excluded from scoring.",
      closesAt: closes,
      opensAt: new Date(now - 2 * DAY),
    }));
  const curTrigQ = await db.insert(s.questions).values(trigQrows).returning({ id: s.questions.id, riskId: s.questions.riskId });
  const rq = new Map(curRiskQ.map((q) => [q.riskId, q.id]));
  const tq = new Map(curTrigQ.map((q) => [q.riskId, q.id]));
  const riskById = new Map(risks.map((x) => [x.id, x]));

  const acapsOf = (x: RiskJson): number | null =>
    LEVEL_PRIOR[x.probability] ?? (x.level === "High" ? 0.8 : x.level === "Medium" ? 0.48 : x.level === "Low" ? 0.4 : null);

  const pFor = (arch: Spec["arch"], o: number | null, ac: number | null, base: number): number => {
    let p: number;
    switch (arch) {
      case "ace":
        p = o === null ? base + gauss(r) * 0.12 : 0.5 + (o ? 1 : -1) * 0.19 + gauss(r) * 0.1;
        break;
      case "solid":
        p = o === null ? base + gauss(r) * 0.17 : 0.5 + (o ? 1 : -1) * 0.09 + gauss(r) * 0.17;
        break;
      case "partisan":
        p = o === null ? 0.88 + gauss(r) * 0.03 : 0.83 + (o ? 0.05 : -0.05) + gauss(r) * 0.08;
        break;
      case "rubber":
        p = (ac ?? 0.5) + gauss(r) * 0.02;
        break;
      case "fence":
        p = 0.5 + gauss(r) * 0.03;
        break;
      default:
        p = 0.05 + r() * 0.9;
    }
    return Math.round(clamp(p, 0.03, 0.97) * 100);
  };
  const secs = (arch: Spec["arch"]) =>
    arch === "speeder" ? 3 + Math.floor(r() * 5) : arch === "rubber" ? 14 + Math.floor(r() * 16) : arch === "fence" ? 9 + Math.floor(r() * 10) : 35 + Math.floor(r() * 70);

  // ---- historical forecasts (resolved risks, real outcomes, SYNTHETIC experts) ----
  const hist: (typeof s.forecasts.$inferInsert)[] = [];
  SPECS.forEach((sp, i) => {
    if (sp.arch === "newbie") return;
    const target = sp.arch === "ace" || sp.arch === "solid" ? 26 : sp.arch === "partisan" ? 18 : 12;
    const own = resolved.filter((x) => x.countries.some((c) => sp.countries.includes(c)));
    const regs = new Set(own.map((x) => x.region));
    const near = resolved.filter((x) => !own.includes(x) && regs.has(x.region));
    const pool2 = [...own, ...near.sort(() => r() - 0.5)].slice(0, target);
    for (const x of pool2) {
      const o = x.status === "Materialised" ? 1 : 0;
      hist.push({
        questionId: hq.get(x.id)!,
        expertId: ids[i],
        probability: pFor(sp.arch, o, acapsOf(x), 0.5),
        confidence: sp.arch === "ace" ? 3 : sp.arch === "speeder" ? 1 : 2,
        reason: sp.arch === "partisan" && r() < 0.4 ? "The regime has obviously been escalating, everyone knows this is coming." : "",
        evidenceType: "none",
        secondsSpent: secs(sp.arch),
        coiFlag: !!sp.coi && r() < 0.3,
        createdAt: new Date(now - 430 * DAY + r() * 30 * DAY),
      });
    }
  });
  // second-look revisions for a few experts in history: improves ace/solid slightly
  for (const f of hist) {
    const sp = SPECS[ids.indexOf(f.expertId)];
    if ((sp.arch === "ace" || sp.arch === "solid") && r() < 0.25) {
      const q = resolved.find((x) => hq.get(x.id) === f.questionId)!;
      const o = q.status === "Materialised" ? 1 : 0;
      f.revised = Math.round(clamp(f.probability / 100 + (o ? 0.05 : -0.05), 0.03, 0.97) * 100);
    }
  }
  await chunked(hist, (c) => db.insert(s.forecasts).values(c), 150);

  // ---- current forecasts on open questions ----
  const cur: (typeof s.forecasts.$inferInsert)[] = [];
  const handcrafted: Record<string, { by: number; p: number; reason: string; ev: string; secs: number }[]> = {
    R1043: [
      { by: 1, p: 82, reason: "Drone strikes near Adré have recurred and Chadian units have rotated north; retaliatory fire from RSF-aligned groups is the most credible path to a sustained confrontation.", ev: "direct", secs: 74 },
      { by: 2, p: 42, reason: "Border incidents so far are localised. Ndjamena has strong incentives to avoid direct engagement, so sustained military confrontation on Chadian territory within six months is less likely than the rating implies.", ev: "analysis", secs: 88 },
      { by: 4, p: 71, reason: "Refugee arrivals are pushing Ouaddaï and Sila toward IPC 3, which raises the humanitarian cost of even localised incidents.", ev: "data", secs: 52 },
      { by: 22, p: 80, reason: "", ev: "none", secs: 21 },
      { by: 25, p: 50, reason: "Hard to say.", ev: "none", secs: 12 },
    ],
  };
  const idx = (n: number) => ids[n]; // n is zero-based spec index
  for (const x of active) {
    const qid = rq.get(x.id)!;
    const ac = acapsOf(x);
    const hc = handcrafted[x.id];
    if (hc) {
      for (const h of hc) {
        cur.push({ questionId: qid, expertId: idx(h.by), probability: h.p, confidence: 2, reason: h.reason, evidenceType: h.ev, secondsSpent: h.secs, createdAt: new Date(now - r() * 40 * 3600 * 1000) });
      }
      continue;
    }
    SPECS.forEach((sp, i) => {
      if (sp.arch === "newbie") return;
      if (!x.countries.some((c) => sp.countries.includes(c))) return;
      if (r() < 0.32) return;
      const p = pFor(sp.arch, null, ac, ac ?? 0.45);
      const tr = THEME_REASONS[x.theme] ?? THEME_REASONS.conflict;
      const pool3 = ac !== null && p / 100 > ac + 0.1 ? tr.up : ac !== null && p / 100 < ac - 0.1 ? tr.down : tr.same;
      let reason = sp.arch === "ace" || sp.arch === "solid" ? pool3[Math.floor(r() * pool3.length)] : "";
      if (sp.arch === "partisan") reason = "The regime is obviously escalating — everyone knows this is 100% going to happen.";
      cur.push({
        questionId: qid,
        expertId: ids[i],
        probability: p,
        confidence: 2,
        reason,
        evidenceType: sp.arch === "ace" ? "direct" : sp.arch === "solid" ? "data" : "none",
        secondsSpent: secs(sp.arch),
        coiFlag: !!sp.coi,
        createdAt: new Date(now - r() * 60 * 3600 * 1000),
      });
    });
    // trigger-level forecasts (a few)
    const tqid = tq.get(x.id);
    if (tqid) {
      SPECS.forEach((sp, i) => {
        if (sp.arch !== "ace" && sp.arch !== "solid") return;
        if (!x.countries.some((c) => sp.countries.includes(c)) || r() < 0.5) return;
        cur.push({ questionId: tqid, expertId: ids[i], probability: Math.round(clamp(0.55 + gauss(r) * 0.2, 0.05, 0.95) * 100), confidence: 2, reason: "", evidenceType: "none", secondsSpent: 40, createdAt: new Date(now - r() * 40 * 3600 * 1000) });
      });
    }
  }
  const dedup = new Map<string, (typeof cur)[number]>();
  for (const f of cur) dedup.set(`${f.questionId}-${f.expertId}`, f);
  const curRows = [...dedup.values()];
  await chunked(curRows, (c) => db.insert(s.forecasts).values(c), 150);

  // ---- dissents ----
  const inserted = await db.select().from(s.forecasts);
  const states = ["open", "routed", "actioned", "notified", "closed"];
  const diss: (typeof s.dissents.$inferInsert)[] = [];
  let k = 0;
  for (const f of inserted) {
    const q = [...curRiskQ].find((x) => x.id === f.questionId);
    if (!q) continue;
    const ac = acapsOf(riskById.get(q.riskId)!);
    if (ac === null) continue;
    const gap = Math.abs(f.probability - ac * 100);
    if (gap >= 25 && f.reason.length > 20) {
      const st = f.expertId === idx(2) ? "routed" : states[k % states.length];
      diss.push({
        forecastId: f.id,
        questionId: f.questionId,
        riskId: q.riskId,
        gap: Math.round(gap),
        state: st,
        analystNote: st === "actioned" || st === "notified" || st === "closed" ? "Analyst added the dissenting reasoning to the next rationale update and asked the circle for evidence." : "",
      });
      k++;
    }
  }
  if (diss.length) await db.insert(s.dissents).values(diss);

  // ---- roundtable ----
  const mkPost = async (riskId: string, by: number, mode: string, kind: string, body: string, parent: number | null, src = "", hoursAgo = 20) =>
    (
      await db
        .insert(s.posts)
        .values({ riskId, expertId: idx(by), identityMode: mode, kind, body, parentId: parent, sourceUrl: src, createdAt: new Date(now - hoursAgo * 3600 * 1000) })
        .returning({ id: s.posts.id })
    )[0].id;
  const p1 = await mkPost("R1043", 1, "profile", "claim", "The credible escalation path is retaliation by RSF-aligned groups after SAF drone use near Adré — not a deliberate Chadian entry into the war. Watch the northern deployments.", null, "", 30);
  const p2 = await mkPost("R1043", 2, "profile", "counter", "I'd separate border spillover from sustained confrontation. Incidents so far are localised, and the government has every incentive to avoid direct engagement. I'd sit well below the ACAPS rating.", p1, "", 26);
  const p3 = await mkPost("R1043", 4, "profile", "evidence", "FEWS NET shows refugee arrivals pushing Ouaddaï and Sila toward IPC 3 — even localised incidents now carry a high humanitarian cost.", null, "https://reliefweb.int/report/chad/chad-food-security-outlook-update-refugee-impacts-are-driving-income-and-consumption-toward-crisis-ipc-phase-3-april-september-2026", 22);
  const p4 = await mkPost("R1043", 22, "profile", "question", "Is anyone seeing returns of host-community members around Tine, or is movement mostly one-directional?", null, "", 14);
  await mkPost("R1043", 1, "sealed", "evidence", "Local contacts report that checkpoint staffing near the border has doubled in recent weeks.", p4, "", 9);
  await mkPost("R1043", 4, "profile", "missing_risk", "ACAPS may be missing a trigger: closure of cross-border trade routes disrupting host-community prices, independent of any violence.", null, "", 6);
  const q1 = await mkPost("R1048", 6, "profile", "claim", "Access constraints around besieged areas are tightening faster than the analysis assumes.", null, "", 40);
  const q2 = await mkPost("R1048", 7, "profile", "counter", "Constraints are real but negotiated pauses have repeatedly opened short windows. I'd weigh both.", q1, "", 33);
  await db.insert(s.reactions).values([
    { postId: p2, expertId: idx(4), type: "changed_mind" },
    { postId: p2, expertId: idx(1), type: "new_info" },
    { postId: p2, expertId: idx(21), type: "new_info" },
    { postId: p2, expertId: idx(22), type: "changed_mind" },
    { postId: p3, expertId: idx(2), type: "new_info" },
    { postId: p3, expertId: idx(1), type: "new_info" },
    { postId: p1, expertId: idx(2), type: "disagree" },
    { postId: p4, expertId: idx(2), type: "new_info" },
    { postId: q2, expertId: idx(6), type: "changed_mind" },
    { postId: q2, expertId: idx(9), type: "changed_mind" },
  ]);

  await db.insert(s.meta).values({ key: "seeded_at", value: new Date().toISOString() }).onConflictDoNothing();
  void sql;
}

async function seedNotifications() {
  const w = await loadWorld();
  const now = Date.now();
  const r = rng(77);
  const qs = w.questions.filter((q) => q.status === "open" && !q.triggerId);
  const rows: (typeof s.notifications.$inferInsert)[] = [];
  for (const q of qs) {
    const risk = w.riskById.get(q.riskId)!;
    const plan = planDispatch(w, risk, q, now);
    for (const p of plan) {
      if (p.decision === "answered") continue;
      const createdAt = new Date(now - r() * 50 * 3600 * 1000);
      const row = {
        expertId: p.expertId,
        kind: "question",
        questionId: q.id,
        riskId: q.riskId,
        title: `${risk.country}: ${risk.title.slice(0, 110)}`,
        reason: p.reason,
        score: p.score,
        suppressed: p.decision === "suppress",
        createdAt,
      };
      rows.push(row);
      w.notifications.push({ ...row, id: -1, readAt: null, questionId: q.id, riskId: q.riskId } as (typeof w.notifications)[number]);
    }
  }
  const good = rows.filter((x) => (x.score ?? 0) >= 40 || !x.suppressed);
  await chunked(good, (c) => db.insert(s.notifications).values(c), 200);
  // impact receipts for dissenters whose dissent was actioned / notified / closed
  const imp: (typeof s.notifications.$inferInsert)[] = [];
  for (const d of w.dissents) {
    if (!["actioned", "notified", "closed"].includes(d.state)) continue;
    const f = w.forecasts.find((x) => x.id === d.forecastId);
    const risk = w.riskById.get(d.riskId);
    if (!f || !risk) continue;
    imp.push({
      expertId: f.expertId,
      kind: "impact",
      riskId: d.riskId,
      questionId: d.questionId,
      title: `Your dissent on ${risk.country} was heard`,
      reason: "An ACAPS analyst folded your reasoning into the next rationale update and asked the circle for evidence. Your identity was never shared.",
      score: 100,
      createdAt: new Date(now - 6 * 3600 * 1000),
    });
  }
  if (imp.length) await db.insert(s.notifications).values(imp);
}
