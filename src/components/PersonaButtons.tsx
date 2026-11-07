"use client";

export function PersonaButtons({ items }: { items: { id: number; title: string; sub: string; badge: string; to: string }[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((p) => (
        <button
          key={p.id}
          onClick={async () => {
            await fetch("/api/session", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ expertId: p.id }),
            });
            window.location.href = p.to;
          }}
          className="rounded-2xl border border-stone-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-teal-600 hover:shadow"
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-teal-700">{p.badge}</div>
          <div className="mt-1 font-semibold text-slate-900">{p.title}</div>
          <div className="mt-1 text-sm text-slate-600">{p.sub}</div>
          <div className="mt-3 text-sm font-medium text-teal-700">Enter →</div>
        </button>
      ))}
    </div>
  );
}

