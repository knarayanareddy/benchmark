import { currentExpert } from "@/lib/session";
import { Card, H } from "@/components/ui";
import { DispatchLab } from "@/components/ModTools";
import { ModNav } from "@/components/ModNav";

export default async function DispatchPage() {
  const { me, w } = await currentExpert();
  if (!me?.isModerator) return <Card><p>Moderators only.</p></Card>;
  const risks = w.risks
    .filter((r) => r.status === "Active")
    .map((r) => ({
      id: r.id,
      label: `${r.country} · ${r.title.slice(0, 80)}`,
      triggers: w.triggers.filter((t) => t.riskId === r.id).map((t) => ({ id: t.id, title: t.title })),
    }));
  return (
    <div>
      <H sub="Publish a new question when ACAPS publishes or changes a risk. The dispatcher scores every expert against the topic, applies their own thresholds and weekly cap, and tells you who it will — and won't — bother.">Dispatch lab</H>
      <ModNav here="/moderator/dispatch" />
      <Card>
        <DispatchLab risks={risks} />
      </Card>
      <Card className="mt-6 text-sm text-slate-700">
        <h3 className="mb-1 font-semibold">Dispatch rules</h3>
        <ul className="list-inside list-disc space-y-0.5">
          <li><b>Relevance</b> = country (60) + region (22) + theme (25) + “circle needs views” (10). Below the expert&apos;s own threshold → silent.</li>
          <li><b>Cap</b> = each expert&apos;s own weekly maximum. Over the cap → recorded as suppressed and shown to the expert on their radar, never pushed.</li>
          <li><b>Never</b> a notification for chatter. The only other pushes: direct replies, impact receipts and resolution receipts.</li>
          <li><b>Transparency</b>: every send and every suppression is logged and shown to the expert as “why am I seeing this”.</li>
        </ul>
      </Card>
    </div>
  );
}
