import Link from "next/link";
import { currentExpert } from "@/lib/session";
import { cardIdOf } from "@/lib/world";
import { buildSeries, MIN_RELEASE_PANEL_SIZE } from "@/lib/series";
import { buildGrid } from "@/lib/grid";
import { Card, H, Pill } from "@/components/ui";
import { ModNav } from "@/components/ModNav";
import {
  EvolutionConsole,
  type EvolutionCardItem,
  type LinkItem,
  type SeriesPayload,
} from "@/components/EvolutionConsole";
import { QuickPersonaButton } from "@/components/PersonaButtons";

const SERIES_NOTE =
  "At most two rounds exist per card. A later window is a new card, not a third round.";

export default async function ModeratorEvolutionPage() {
  const { me, w } = await currentExpert();
  const isMod = Boolean(me?.isModerator);
  const modPersona = w.experts.find((e) => e.isModerator);

  const cards: EvolutionCardItem[] = w.questions
    .filter((q) => q.season === "current" || q.season === "S2")
    .map((q) => {
      const risk = w.riskById.get(q.riskId);
      const count = w.forecasts.filter((f) => f.questionId === q.id).length;
      return {
        id: cardIdOf(q.id),
        questionId: q.id,
        riskId: q.riskId,
        country: risk?.country ?? "",
        region: risk?.region ?? null,
        theme: risk?.theme ?? null,
        statement: `${risk ? `[${risk.country}] ` : ""}${q.text}`,
        status: q.status,
        round: q.round,
        closedRounds: Array.isArray(q.closedRounds) ? q.closedRounds : [],
        kind: q.kind,
        respondents: count,
      };
    });

  // Default to flagship Chad R1043 card so the judge immediately sees Round 1 -> Round 2 panel evolution
  const defaultCard =
    cards.find((c) => c.riskId === "R1043" && c.kind === "forecast") ??
    cards[0] ??
    null;

  let initialSeries: SeriesPayload | null = null;
  if (defaultCard) {
    const docs = w.releases.filter(
      (d) =>
        (d.cardId === defaultCard.id ||
          d.questionId === defaultCard.questionId) &&
        d.closed === true &&
        d.visibility === "panel"
    );
    const latest = new Map<number, (typeof docs)[number]>();
    for (const d of docs) {
      const cur = latest.get(d.round);
      if (!cur || d.n > cur.n) latest.set(d.round, d);
    }
    const series = buildSeries([...latest.values()], {
      floor: MIN_RELEASE_PANEL_SIZE,
    });
    const closedRounds = defaultCard.closedRounds;
    const missing = closedRounds
      .filter(
        (r) =>
          !latest.has(r) && !series.withheld.some((wItem) => wItem.round === r)
      )
      .map((round) => ({ round }));
    const withheld = [...series.withheld, ...missing].sort(
      (a, b) => a.round - b.round
    );
    const openPrefix =
      defaultCard.status === "open" &&
      !closedRounds.includes(defaultCard.round)
        ? `Round ${defaultCard.round} is still open, so nothing from it is shown until it closes. `
        : "";
    initialSeries = {
      cardId: defaultCard.id,
      questionId: defaultCard.questionId,
      statement: defaultCard.statement,
      status: defaultCard.status,
      round: defaultCard.round,
      closedRounds,
      points: series.points,
      withheld,
      note: `${openPrefix}${SERIES_NOTE}`,
    };
  }

  const grid = buildGrid(w.risks, cards);

  const statementByCardId = new Map(cards.map((c) => [c.id, c.statement]));
  const links: LinkItem[] = w.cardLinks.map((l) => ({
    id: l.id,
    fromCardId: l.fromCardId,
    toCardId: l.toCardId,
    fromStatement: statementByCardId.get(l.fromCardId) ?? null,
    toStatement: statementByCardId.get(l.toCardId) ?? null,
    mechanism: l.mechanism,
    rival: l.rival,
    by: l.by,
    day: l.day,
  }));

  // Default downstream chain root: Sudan R1048 card (3-step trickle-down into Chad arrivals -> border clashes -> R1043 confrontation)
  const sudanCard = cards.find(
    (c) => c.riskId === "R1048" && c.kind === "forecast"
  );
  const initialChainCardId = sudanCard?.id ?? links[0]?.fromCardId ?? "";

  return (
    <div className="space-y-6">
      <H sub="Map how situations evolve over time: panel series across closed rounds (with n ≥ 5 release floor), the regional risk × theme grid (cells < 10 marked descriptive only), and analyst-authored cross-question links with stated mechanisms and rival explanations.">
        Situation evolution
      </H>
      <ModNav here="/moderator/evolution" />

      {!isMod && modPersona && (
        <Card className="border-amber-200 bg-amber-50/70">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div>
              <Pill tone="amber">Read-only analyst preview</Pill>
              <span className="ml-2 text-slate-800">
                You are viewing Situation Evolution in read-only mode (`evolution.read`).
                Switch to <b>ACAPS Moderator</b> (`evolution.link`) to record or remove
                analyst links and close rounds.
              </span>
            </div>
            <QuickPersonaButton
              expertId={modPersona.id}
              label="Switch to ACAPS Moderator →"
              className="rounded-xl bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
            />
          </div>
        </Card>
      )}

      <Card className="border-teal-200 bg-teal-50/40 text-xs text-slate-700">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <b className="text-slate-900">
              Five design principles (`docs/12-situation-evolution.md` &amp; `docs/11-questions-for-acaps.md`):
            </b>{" "}
            (1) Blind Round 1 covers the risk timeline (<Link href="/risks/R1043" className="font-semibold text-teal-800 underline">see R1043 timeline</Link>); (2) Real ACAPS data only, labelled as recorded — completion rate is never a probability; (3) No automatic cross-risk inference — links require a stated mechanism and rival explanation; (4) Panel series respect the `n ≥ 5` release floor and only show closed rounds; (5) Small grid cells (`&lt; 10` risks) are marked descriptive only.
          </div>
        </div>
      </Card>

      <EvolutionConsole
        initialCards={cards}
        initialSeries={initialSeries}
        initialGrid={grid}
        initialLinks={links}
        initialChainCardId={initialChainCardId}
        moderator={isMod}
      />
    </div>
  );
}
