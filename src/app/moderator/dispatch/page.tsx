import { currentExpert } from "@/lib/session";
import { buildTimeline } from "@/lib/timeline";
import { Card, H } from "@/components/ui";
import { DispatchLab } from "@/components/ModTools";
import { ModNav } from "@/components/ModNav";
import { QuickPersonaButton } from "@/components/PersonaButtons";

export default async function DispatchPage() {
  const { me, w } = await currentExpert();
  const modPersona = w.experts.find((e) => e.isModerator);
  if (!me?.isModerator) {
    return (
      <div className="space-y-4">
        <ModNav here="/moderator/dispatch" />
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-700">
            Moderator console — Dispatch lab. Switch to ACAPS Moderator to preview
            and dispatch questions.
          </p>
          {modPersona && (
            <QuickPersonaButton
              expertId={modPersona.id}
              label="Switch to ACAPS Moderator →"
            />
          )}
        </Card>
      </div>
    );
  }
  const risks = w.risks
    .filter((r) => r.status === "Active")
    .map((r) => {
      const rTriggers = w.triggers.filter((t) => t.riskId === r.id);
      const timeline = buildTimeline({
        riskTrend: r.trend,
        rationaleUpdates: r.rationaleUpdates,
        triggers: rTriggers.map((t) => ({
          id: t.id.replace(`${r.id}-`, ""),
          title: t.title,
          completionHistory: t.completionHistory,
          trendHistory: t.trendHistory,
          dateEnteredISO: t.dateEnteredISO,
          lastUpdateISO: t.lastUpdateISO,
        })),
      });
      return {
        id: r.id,
        label: `${r.country} (${r.id}) · ${r.title.slice(0, 80)}`,
        triggers: rTriggers.map((t) => ({ id: t.id, title: t.title })),
        timeline,
      };
    });
  return (
    <div>
      <H sub="Publish a new question when ACAPS publishes or changes a risk. Inspect the risk's recorded Situation Evolution timeline below, run a dry-run dispatch against expert declarations and weekly caps, and see who it will — and won't — bother.">
        Dispatch lab
      </H>
      <ModNav here="/moderator/dispatch" />
      <Card>
        <DispatchLab risks={risks} />
      </Card>
      <Card className="mt-6 text-sm text-slate-700">
        <h3 className="mb-1 font-semibold">Dispatch rules</h3>
        <ul className="list-inside list-disc space-y-0.5">
          <li>
            <b>Relevance</b> = country (60) + region (22) + theme (25) + “circle
            needs views” (10). Below the expert&apos;s own threshold → silent.
          </li>
          <li>
            <b>Cap</b> = each expert&apos;s own weekly maximum. Over the cap →
            recorded as suppressed and shown to the expert on their radar, never
            pushed.
          </li>
          <li>
            <b>Never</b> a notification for chatter. The only other pushes: direct
            replies, impact receipts and resolution receipts.
          </li>
          <li>
            <b>Transparency</b>: every send and every suppression is logged and
            shown to the expert as “why am I seeing this”.
          </li>
        </ul>
      </Card>
    </div>
  );
}
