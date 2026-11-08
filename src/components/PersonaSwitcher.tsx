"use client";

export function PersonaSwitcher({
  current,
  options,
}: {
  current: number | null;
  options: { id: number; label: string; group: string }[];
}) {
  const groups = Array.from(new Set(options.map((o) => o.group)));

  return (
    <select
      aria-label="Demo as"
      className="max-w-[210px] rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs text-slate-800"
      value={current ?? ""}
      onChange={async (e) => {
        const v = e.target.value;
        if (v === "join") {
          const currentPath = typeof window !== "undefined" ? window.location.pathname : "/me";
          window.location.href = `/join?returnTo=${encodeURIComponent(currentPath)}`;
          return;
        }

        if (!v) {
          await fetch("/api/session", { method: "DELETE" });
          window.location.reload();
          return;
        }

        const expertId = Number(v);
        const res = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expertId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          alert(data.error || "Failed to switch persona.");
          return;
        }

        const selectedOpt = options.find((o) => o.id === expertId);
        const isMod = selectedOpt?.group === "ACAPS";
        const currentPath = typeof window !== "undefined" ? window.location.pathname : "/";

        if (currentPath === "/moderator" && !isMod) {
          window.location.href = "/pulse";
        } else if (isMod && currentPath === "/me") {
          window.location.href = "/moderator";
        } else {
          window.location.reload();
        }
      }}
    >
      <option value="">Demo as… (signed out)</option>
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {options
            .filter((o) => o.group === g)
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
        </optgroup>
      ))}
      <option value="join">+ Create / Join new profile…</option>
    </select>
  );
}

export function LangToggle({ lang }: { lang: "en" | "fr" }) {
  return (
    <button
      className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-stone-100"
      onClick={async () => {
        await fetch("/api/lang", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lang: lang === "en" ? "fr" : "en" }),
        });
        window.location.reload();
      }}
    >
      {lang === "en" ? "FR" : "EN"}
    </button>
  );
}

