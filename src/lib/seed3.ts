import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import { loadWorld, cardIdOf } from "./world";
import { planDispatch } from "./dispatch";
import { aggregate, buildStats, MIN_PANEL } from "./scoring";
import riskData from "@/data/risks.json";

const DAY = 24 * 3600 * 1000;
const MIN = 60 * 1000;

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

type Sig = {
  country: string;
  text: string;
  criteria: string;
  outcome?: "yes" | "no";
  ageDays?: number;
  daysLeft?: number;
};

const SIGNALS: Sig[] = [
  {
    country: "Chad",
    text: "Within 14 days, will ACLED record at least one armed clash within 30 km of the Adré border crossing?",
    criteria: "YES if ACLED lists ≥1 battle/violence event inside the radius in the window.",
    outcome: "yes",
    ageDays: 38,
  },
  {
    country: "Chad",
    text: "Within 14 days, will the Adré crossing be closed to humanitarian traffic for 48+ consecutive hours?",
    criteria: "YES if OCHA/UNHCR access reporting confirms a closure of 48h or more.",
    outcome: "no",
    ageDays: 31,
  },
  {
    country: "Mali",
    text: "Within 14 days, will a main supply road to a regional capital be blockaded or attacked, per credible public reporting?",
    criteria: "YES if two independent public sources report a blockade or attack on the road in the window.",
    outcome: "yes",
    ageDays: 27,
  },
  {
    country: "Sudan",
    text: "Within 21 days, will OCHA publish a flash update citing new displacement of 50,000+ people?",
    criteria: "YES if an OCHA flash update in the window states 50,000+ newly displaced.",
    outcome: "no",
    ageDays: 24,
  },
  {
    country: "Syria",
    text: "Within 14 days, will WFP or OCHA report a bread or fuel price rise above 10% in a major city?",
    criteria: "YES if a market-monitoring bulletin in the window shows a >10% rise.",
    outcome: "no",
    ageDays: 20,
  },
  {
    country: "Afghanistan",
    text: "Within 14 days, will IOM report more than 20,000 returns from Pakistan in a single week?",
    criteria: "YES if an IOM flow report in the window shows a weekly figure above 20,000.",
    outcome: "yes",
    ageDays: 16,
  },
  {
    country: "Nigeria",
    text: "Within 14 days, will NEMA or OCHA report flooding that displaces 10,000+ people?",
    criteria: "YES if an official or OCHA report in the window gives 10,000+ displaced by flooding.",
    outcome: "no",
    ageDays: 12,
  },
  {
    country: "Yemen",
    text: "Within 14 days, will an IPC/FEWS NET alert or update raise the food-insecurity phase for any governorate?",
    criteria: "YES if a published update in the window raises a phase classification.",
    outcome: "yes",
    ageDays: 9,
  },
  // open now
  {
    country: "Chad",
    text: "Within the next 14 days, will UNHCR report 3,000+ new arrivals from Sudan into eastern Chad in a single week?",
    criteria: "YES if a UNHCR operational update in the window shows ≥3,000 new weekly arrivals.",
    daysLeft: 11,
  },
  {
    country: "Sudan",
    text: "Within the next 14 days, will a humanitarian convoy be denied access or attacked in Darfur, per OCHA access reporting?",
    criteria: "YES if OCHA access snapshots/flash updates in the window record such an incident.",
    daysLeft: 10,
  },
  {
    country: "Mali",
    text: "Within the next 14 days, will fuel shortages force a shutdown of public services in Bamako?",
    criteria: "YES if two independent sources report suspended services due to fuel shortages.",
    daysLeft: 12,
  },
  {
    country: "Lebanon",
    text: "Within the next 14 days, will evacuation orders affect 20,000+ people in a single announcement?",
    criteria: "YES if an official order or OCHA update in the window cites 20,000+ people.",
    daysLeft: 9,
  },
];

export async function seedSignals() {
  // atomic claim so concurrent workers never seed twice
  const claimed = await db
    .insert(s.meta)
    .values({ key: "v3_signals", value: "1" })
    .onConflictDoNothing()
    .returning();
  if (!claimed.length) return;
  const w = await loadWorld();
  const now = Date.now();
  const r = rng(2026);
  const experts = w.experts.filter((e) => !e.isModerator);
  const pairNames = ["Tariq Aziz", "Lea Moreau"];
  const pair = experts.filter((e) => pairNames.includes(e.realName));

  const riskFor = (country: string) =>
    w.risks.find((x) => x.status === "Active" && x.countries.includes(country)) ??
    w.risks.find((x) => x.countries.includes(country));

  type Pending = { qid: number; risk: string; country: string; sig: Sig; opensAt: Date };
  const created: Pending[] = [];
  for (const sg of SIGNALS) {
    const risk = riskFor(sg.country);
    if (!risk) continue;
    const resolved = !!sg.outcome;
    const opensAt = new Date(now - (resolved ? sg.ageDays! + 14 : 3) * DAY);
    const closesAt = new Date(resolved ? now - sg.ageDays! * DAY : now + sg.daysLeft! * DAY);
    const [q] = await db
      .insert(s.questions)
      .values({
        riskId: risk.id,
        text: sg.text,
        criteria: sg.criteria + " ‘Unobservable’ is never counted as a miss.",
        kind: "signal",
        season: "S2",
        status: resolved ? "resolved" : "open",
        outcome: sg.outcome ?? null,
        opensAt,
        closesAt,
      })
      .returning({ id: s.questions.id });
    created.push({ qid: q.id, risk: risk.id, country: sg.country, sig: sg, opensAt });
  }

  const fcs: (typeof s.forecasts.$inferInsert)[] = [];
  const pairBase = new Map<number, number>();
  for (const c of created) {
    const resolved = !!c.sig.outcome;
    const o = c.sig.outcome === "yes" ? 1 : 0;
    const target = o ? 86 : 14;
    if (resolved && pair.length === 2) {
      const base = clamp(Math.round(40 + r() * 40), 20, 80);
      pairBase.set(c.qid, base);
      pair.forEach((e, i) => {
        fcs.push({
          questionId: c.qid,
          expertId: e.id,
          probability: base + (i ? 1 : 0),
          confidence: 2,
          reason:
            "Heard from contacts that tensions are rising near the border and the situation looks unstable this period.",
          evidenceType: "local_source",
          identityMode: "profile",
          secondsSpent: 40 + Math.floor(r() * 20),
          createdAt: new Date(
            c.opensAt.getTime() + 3 * DAY + i * (4 + Math.floor(r() * 5)) * MIN
          ),
        });
      });
    }
    for (const e of experts) {
      if (pairNames.includes(e.realName)) continue;
      const covers = e.countries.includes(c.country);
      if (!covers && r() > 0.12) continue;
      if (!resolved && r() < 0.55) continue;
      if (
        !resolved &&
        ["Fatimé Abakar", "Dr. Claire Nguema", "Idriss Mahamat", "Samuel Eze"].includes(
          e.realName
        )
      )
        continue;
      let p: number;
      let secs = 25 + Math.floor(r() * 45);
      let reason = "";
      switch (e.archetype) {
        case "ace":
          p = target + (r() - 0.5) * 16;
          break;
        case "solid":
          p = 50 + (target - 50) * 0.6 + (r() - 0.5) * 24;
          break;
        case "partisan":
          p = (o ? 80 : 88) + (r() - 0.5) * 10;
          break;
        case "rubber":
          p = 55 + (r() - 0.5) * 10;
          break;
        case "fence":
          p = 50 + (r() - 0.5) * 6;
          break;
        case "speeder":
          p = 20 + r() * 60;
          secs = 3 + Math.floor(r() * 5);
          break;
        default:
          p = 50 + (target - 50) * 0.3 + (r() - 0.5) * 36;
      }
      p = clamp(Math.round(p), 3, 97);
      if (["ace", "solid"].includes(e.archetype)) {
        reason = o
          ? "Contacts on the ground describe exactly this pattern in the past fortnight; it matches what I see on the roads and at the crossing."
          : "Indicators I track locally are quiet; the usual precursors are absent and partners report normal operations.";
      }
      fcs.push({
        questionId: c.qid,
        expertId: e.id,
        probability: p,
        confidence: e.archetype === "ace" ? 3 : 2,
        reason,
        evidenceType: reason ? (e.archetype === "ace" ? "direct" : "local_source") : "none",
        identityMode: "profile",
        coiFlag: e.archetype === "partisan",
        secondsSpent: secs,
        createdAt: new Date(c.opensAt.getTime() + Math.floor((0.2 + r() * 8) * DAY)),
      });
    }
  }
  for (let i = 0; i < fcs.length; i += 200)
    await db.insert(s.forecasts).values(fcs.slice(i, i + 200));

  const receipts: (typeof s.notifications.$inferInsert)[] = [];
  for (const c of created.filter((x) => x.sig.outcome)) {
    const mine = fcs.filter((f) => f.questionId === c.qid);
    const sorted = mine.map((f) => f.probability).sort((a, b) => a - b);
    const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 50;
    const o = c.sig.outcome === "yes" ? 1 : 0;
    for (const f of mine) {
      const b = ((f.probability ?? 50) / 100 - o) ** 2;
      receipts.push({
        expertId: f.expertId,
        kind: "receipt",
        questionId: c.qid,
        riskId: c.risk,
        title: `Signal check resolved: ${c.country} — outcome ${o ? "YES" : "NO"}`,
        reason: `You said ${f.probability}%, the circle median was ${med}%. Brier ${b.toFixed(
          2
        )} (lower is better). This feeds your private calibration mirror — resolved in days, not months.`,
        score: 100,
        readAt: new Date(),
        createdAt: new Date(c.sig.ageDays ? now - (c.sig.ageDays - 1) * DAY : now),
      });
    }
  }
  for (let i = 0; i < receipts.length; i += 200)
    await db.insert(s.notifications).values(receipts.slice(i, i + 200));

  const w2 = await loadWorld();
  const asks: (typeof s.notifications.$inferInsert)[] = [];
  for (const c of created.filter((x) => !x.sig.outcome)) {
    const risk = w2.riskById.get(c.risk)!;
    for (const p of planDispatch(w2, risk, { id: c.qid })) {
      if (p.decision === "answered") continue;
      asks.push({
        expertId: p.expertId,
        kind: "question",
        questionId: c.qid,
        riskId: risk.id,
        title: `Fast loop · ${risk.country}: ${c.sig.text.slice(0, 100)}`,
        reason: p.reason,
        score: p.score,
        suppressed: p.decision === "suppress",
      });
    }
  }
  const seen = new Map<number, number>();
  for (const a of asks.sort((x, y) => (y.score ?? 0) - (x.score ?? 0))) {
    if (a.suppressed) continue;
    const e = w2.expertById.get(a.expertId)!;
    const n = (seen.get(a.expertId) ?? 0) + 1;
    seen.set(a.expertId, n);
    if (n > 1 && n > Math.max(1, e.weeklyCap - 1)) {
      a.suppressed = true;
      a.reason = `Weekly cap reached — available on your radar, not pushed`;
    }
  }
  for (let i = 0; i < asks.length; i += 200)
    await db.insert(s.notifications).values(asks.slice(i, i + 200));
}

/**
 * Seeds Situation Evolution data (docs/12-situation-evolution.md):
 * 1. Backfills timeline fields on risks and triggers if needed.
 * 2. Populates closed-round panel release ledger (`releases`) with Round 1 and Round 2 points,
 *    including withheld rounds where n < 5.
 * 3. Populates analyst-authored links (`cardLinks`) with stated mechanism and rival explanation (20..500 chars),
 *    forming multi-step downstream chains across regional situations.
 */
export async function seedEvolution() {
  const claimed = await db
    .insert(s.meta)
    .values({ key: "v4_evolution", value: "1" })
    .onConflictDoNothing()
    .returning();
  if (!claimed.length) return;

  // 1. Backfill timeline data on existing risks and triggers if any lack it
  const rawRisks = riskData as Array<Record<string, unknown>>;
  for (const r of rawRisks) {
    const id = String(r.id);
    const updates = Array.isArray(r.rationaleUpdates)
      ? (r.rationaleUpdates as Array<{ date: string | null; text: string }>)
      : [];
    const trend = typeof r.riskTrend === "string" && r.riskTrend ? r.riskTrend : String(r.trend ?? "");
    if (updates.length > 0 || trend) {
      await db
        .update(s.risks)
        .set({ rationaleUpdates: updates, trend })
        .where(eq(s.risks.id, id));
    }
    const trigs = Array.isArray(r.triggers) ? (r.triggers as Array<Record<string, unknown>>) : [];
    for (const t of trigs) {
      const tid = `${id}-${String(t.id)}`;
      const ch = Array.isArray(t.completionHistory)
        ? (t.completionHistory as Array<{ date: string; value: number }>)
        : [];
      const th = Array.isArray(t.trendHistory)
        ? (t.trendHistory as Array<{ date: string; value: string }>)
        : [];
      const de = typeof t.dateEnteredISO === "string" ? t.dateEnteredISO : null;
      const lu = typeof t.lastUpdateISO === "string" ? t.lastUpdateISO : null;
      if (ch.length > 0 || th.length > 0 || de || lu) {
        await db
          .update(s.triggers)
          .set({
            completionHistory: ch,
            trendHistory: th,
            dateEnteredISO: de,
            lastUpdateISO: lu,
          })
          .where(eq(s.triggers.id, tid));
      }
    }
  }

  const w = await loadWorld();
  const stats = buildStats(w);
  const now = Date.now();

  // 2. Seed closed-round panel release ledger documents (`releases`)
  const releaseRows: (typeof s.releases.$inferInsert)[] = [];
  const targetQuestions = w.questions.filter(
    (q) => q.season === "current" || q.season === "S2"
  );

  for (const q of targetQuestions) {
    const qForecasts = w.forecasts.filter((f) => f.questionId === q.id);
    const n = qForecasts.length;
    if (n === 0) continue;

    const cid = cardIdOf(q.id);
    const agg = aggregate(w, stats, q.id);
    if (!agg) continue;

    // Flagship multi-round cards (R1043 Chad, R1048 Sudan, plus resolved S2 signal cards) get closed Round 1 & Round 2
    const isFlagshipTwoRound =
      q.riskId === "R1043" || q.riskId === "R1048" || q.status === "resolved";

    if (n < MIN_PANEL) {
      // Withheld round (fewer than 5 respondents): demonstrates the n >= 5 privacy floor in Panel Series
      releaseRows.push({
        cardId: cid,
        questionId: q.id,
        round: 1,
        n,
        closed: true,
        visibility: "panel",
        at: new Date(now - 5 * DAY),
        snapshot: {
          estimate: null,
          lo: null,
          hi: null,
          suppressed: true,
          releaseHeld: true,
        },
      });
      await db
        .update(s.questions)
        .set({ round: 2, closedRounds: [1] })
        .where(eq(s.questions.id, q.id));
    } else if (isFlagshipTwoRound) {
      // Round 1 snapshot (initial instinct before Roundtable / Second Look)
      const r1Est = clamp((agg.rawMean - 4) / 100, 0.05, 0.95);
      const r1Lo = clamp((agg.p10 - 3) / 100, 0.02, r1Est - 0.05);
      const r1Hi = clamp((agg.p90 + 2) / 100, r1Est + 0.05, 0.98);
      releaseRows.push({
        cardId: cid,
        questionId: q.id,
        round: 1,
        n: Math.max(MIN_PANEL, n - 1),
        closed: true,
        visibility: "panel",
        at: new Date(now - 9 * DAY),
        snapshot: {
          estimate: Number(r1Est.toFixed(3)),
          lo: Number(r1Lo.toFixed(3)),
          hi: Number(r1Hi.toFixed(3)),
          suppressed: false,
        },
      });

      // Round 2 snapshot (after blind Round 1 closed and structured Second Look / Roundtable synthesis)
      const r2Est = clamp(agg.mean / 100, 0.05, 0.95);
      const r2Lo = clamp(agg.p10 / 100, 0.02, r2Est - 0.04);
      const r2Hi = clamp(agg.p90 / 100, r2Est + 0.04, 0.98);
      releaseRows.push({
        cardId: cid,
        questionId: q.id,
        round: 2,
        n,
        closed: true,
        visibility: "panel",
        at: new Date(now - 2 * DAY),
        snapshot: {
          estimate: Number(r2Est.toFixed(3)),
          lo: Number(r2Lo.toFixed(3)),
          hi: Number(r2Hi.toFixed(3)),
          suppressed: false,
        },
      });
      await db
        .update(s.questions)
        .set({ round: 2, closedRounds: [1, 2] })
        .where(eq(s.questions.id, q.id));
    } else {
      // Round 1 closed and released; Round 2 currently open
      const est = clamp(agg.mean / 100, 0.05, 0.95);
      const lo = clamp(agg.p10 / 100, 0.02, est - 0.04);
      const hi = clamp(agg.p90 / 100, est + 0.04, 0.98);
      releaseRows.push({
        cardId: cid,
        questionId: q.id,
        round: 1,
        n,
        closed: true,
        visibility: "panel",
        at: new Date(now - 4 * DAY),
        snapshot: {
          estimate: Number(est.toFixed(3)),
          lo: Number(lo.toFixed(3)),
          hi: Number(hi.toFixed(3)),
          suppressed: false,
        },
      });
      await db
        .update(s.questions)
        .set({ round: 2, closedRounds: [1] })
        .where(eq(s.questions.id, q.id));
    }
  }

  if (releaseRows.length) {
    for (let i = 0; i < releaseRows.length; i += 150) {
      await db.insert(s.releases).values(releaseRows.slice(i, i + 150));
    }
  }

  // 3. Seed analyst-authored question links (`cardLinks`) with required mechanism & rival explanation
  const findQ = (pred: (q: (typeof w.questions)[number]) => boolean) =>
    w.questions.find(pred);

  const qSudanRisk = findQ((q) => q.riskId === "R1048" && !q.triggerId && q.season === "current");
  const qChadRisk = findQ((q) => q.riskId === "R1043" && !q.triggerId && q.season === "current");
  const qChadTrig = findQ((q) => q.riskId === "R1043" && Boolean(q.triggerId));
  const qChadArrivalsSig = findQ(
    (q) => q.kind === "signal" && q.text.includes("3,000+ new arrivals from Sudan into eastern Chad")
  );
  const qChadClashSig = findQ(
    (q) => q.kind === "signal" && q.text.includes("armed clash within 30 km of the Adré")
  );
  const qChadClosureSig = findQ(
    (q) => q.kind === "signal" && q.text.includes("Adré crossing be closed to humanitarian traffic")
  );
  const qMaliRoadSig = findQ(
    (q) => q.kind === "signal" && q.text.includes("main supply road to a regional capital be blockaded")
  );
  const qMaliFuelSig = findQ(
    (q) => q.kind === "signal" && q.text.includes("fuel shortages force a shutdown of public services in Bamako")
  );
  const qMaliRisk = findQ(
    (q) =>
      q.season === "current" &&
      !q.triggerId &&
      w.riskById.get(q.riskId)?.countries.includes("Mali") === true
  );

  const today = new Date(now).toISOString().slice(0, 10);
  const linkSeeds: Array<{
    id: string;
    fromQ?: number;
    toQ?: number;
    mechanism: string;
    rival: string;
  }> = [
    {
      id: "lk-1",
      fromQ: qSudanRisk?.id,
      toQ: qChadArrivalsSig?.id,
      mechanism:
        "Intensified SAF-RSF hostilities and siege tactics in Darfur directly accelerate cross-border flight across West Darfur into Adré and Ouaddaï reception centres in eastern Chad.",
      rival:
        "Refugee arrival spikes into eastern Chad may instead be driven by seasonal market collapse and exhaustion of rural grain stocks inside Darfur even during lulls in front-line combat.",
    },
    {
      id: "lk-2",
      fromQ: qChadArrivalsSig?.id,
      toQ: qChadClashSig?.id,
      mechanism:
        "Surging cross-border movements and armed group transit near Adré draw SAF drone surveillance and RSF pursuit units toward the border corridor, raising the risk of border-zone clashes.",
      rival:
        "Cross-border clashes near Adré may stem from autonomous local smuggling disputes or Zaghawa-Arab communal friction unrelated to the volume of civilian refugee arrivals.",
    },
    {
      id: "lk-3",
      fromQ: qChadClashSig?.id,
      toQ: qChadRisk?.id,
      mechanism:
        "Repeated armed clashes and drone strikes inside Chadian territory near Adré pressure N'Djamena to deploy northern units and retaliate, escalating into sustained military confrontation.",
      rival:
        "Both N'Djamena and Sudanese belligerents retain strong bilateral deterrence incentives to contain border incidents via military hotlines without escalating to state-to-state confrontation.",
    },
    {
      id: "lk-4",
      fromQ: qChadClashSig?.id,
      toQ: qChadClosureSig?.id,
      mechanism:
        "Armed incidents within 30 km of Adré trigger immediate Chadian security cordons and temporary suspension of UN humanitarian convoy clearances across the border crossing.",
      rival:
        "Border crossing closures at Adré are more frequently caused by administrative customs disputes, rainy-season wadi flooding, or sovereign inspection decrees than by kinetic clashes.",
    },
    {
      id: "lk-5",
      fromQ: qChadRisk?.id,
      toQ: qChadTrig?.id,
      mechanism:
        "If cross-border spillover escalates, armed groups and proxy forces expand attacks along eastern supply corridors and strategic border infrastructure inside Chad.",
      rival:
        "Chadian elite garrison deployments around strategic towns may deter infrastructure attacks even if low-intensity border skirmishes continue in rural Ennedi-Est.",
    },
    {
      id: "lk-6",
      fromQ: qMaliRoadSig?.id,
      toQ: qMaliFuelSig?.id,
      mechanism:
        "Blockades and attacks on primary southern and western arterial supply corridors interdict tanker convoys, rapidly depleting municipal fuel reserves and forcing service shutdowns in Bamako.",
      rival:
        "Public service disruptions in Bamako may be driven primarily by state utility debt, regional grid maintenance failures, or fiscal liquidity crunches rather than road interdiction.",
    },
    {
      id: "lk-7",
      fromQ: qMaliFuelSig?.id,
      toQ: qMaliRisk?.id,
      mechanism:
        "Sustained urban fuel shortages and suspended municipal services compound household livelihood stress and erode state response capacity across contested central and northern regions.",
      rival:
        "Rural conflict escalation in Mali follows dry-season insurgent mobility cycles that operate largely independently of municipal fuel availability in Bamako.",
    },
  ];

  const validRows: (typeof s.cardLinks.$inferInsert)[] = [];
  const seenPairs = new Set<string>();
  for (const item of linkSeeds) {
    if (!item.fromQ || !item.toQ || item.fromQ === item.toQ) continue;
    const fromCardId = cardIdOf(item.fromQ);
    const toCardId = cardIdOf(item.toQ);
    const pairKey = `${fromCardId}->${toCardId}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
    validRows.push({
      id: item.id,
      fromCardId,
      toCardId,
      mechanism: item.mechanism,
      rival: item.rival,
      by: "ACAPS moderator",
      day: today,
      version: 0,
    });
  }

  if (validRows.length) {
    await db.insert(s.cardLinks).values(validRows).onConflictDoNothing();
  }
}
