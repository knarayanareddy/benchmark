import { getWorld } from "@/lib/world";
import { JoinFlow } from "@/components/JoinFlow";
import { H } from "@/components/ui";

export default async function Join({ searchParams }: { searchParams?: Promise<{ returnTo?: string }> }) {
  const sp = searchParams ? await searchParams : {};
  const w = await getWorld();
  const countries = Array.from(new Set(w.risks.flatMap((r) => r.countries))).sort();
  return (
    <div>
      <H sub="Four short steps. You decide how much of you the world — and ACAPS — ever sees.">Join the circle</H>
      <JoinFlow countries={countries} returnTo={sp.returnTo} />
    </div>
  );
}
