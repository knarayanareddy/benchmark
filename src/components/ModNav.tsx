import Link from "next/link";

export function ModNav({ here }: { here: string }) {
  const items: [string, string][] = [
    ["/moderator", "Overview"],
    ["/moderator/evolution", "Situation evolution"],
    ["/moderator/dispatch", "Dispatch lab"],
    ["/moderator/synthesis", "Synthesis & resolution"],
    ["/moderator/integrity", "Integrity signals"],
  ];
  return (
    <div className="mb-6 flex flex-wrap gap-2">
      {items.map(([h, l]) => (
        <Link
          key={h}
          href={h}
          className={`rounded-full px-4 py-1.5 text-sm font-medium ${
            h === here
              ? "bg-slate-900 text-white"
              : "bg-white ring-1 ring-stone-300 hover:bg-stone-100"
          }`}
        >
          {l}
        </Link>
      ))}
    </div>
  );
}
