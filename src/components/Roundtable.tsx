"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { POST_KINDS, REACTION_TYPES } from "@/lib/constants";
import { detectLeaks } from "@/lib/scrub";

export type PostView = {
  id: number;
  parentId: number | null;
  who: string;
  sub: string;
  level: string;
  self: boolean;
  kind: string;
  body: string;
  sourceUrl: string;
  when: string;
  reactions: Record<string, { count: number; mine: boolean }>;
};

type LevelOpt = { id: string; name: string };

function Composer({ riskId, parentId, levelOptions, profileLevel, onDone, defaultKind }: { riskId: string; parentId?: number; levelOptions: LevelOpt[]; profileLevel: string; onDone: () => void; defaultKind: string }) {
  const router = useRouter();
  const [kind, setKind] = useState(defaultKind);
  const [body, setBody] = useState("");
  const [src, setSrc] = useState("");
  const [mode, setMode] = useState("profile");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const leaks = useMemo(() => detectLeaks(body), [body]);
  const eff = mode === "profile" ? profileLevel : mode;
  async function send() {
    setBusy(true);
    setErr("");
    const r = await fetch("/api/posts", { method: "POST", body: JSON.stringify({ riskId, parentId, kind, body, sourceUrl: src, identityMode: mode }) });
    const j = await r.json();
    setBusy(false);
    if (!j.ok) return setErr(j.error);
    setBody("");
    setSrc("");
    onDone();
    router.refresh();
  }
  return (
    <div className="space-y-2 rounded-xl border border-stone-200 bg-stone-50 p-3">
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(POST_KINDS).map(([k, v]) => (
          <button key={k} onClick={() => setKind(k)} className={`rounded-full border px-2.5 py-0.5 text-xs ${kind === k ? "border-teal-700 bg-teal-700 text-white" : "border-stone-300 bg-white text-slate-600"}`}>{v}</button>
        ))}
      </div>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={1200} placeholder={kind === "counter" ? "Steelman first: what's right in the other view? Then what you see differently." : "Claim · evidence · what would change your mind"} className="w-full rounded-lg border border-stone-300 bg-white p-2 text-sm outline-none focus:border-teal-600" />
      <input value={src} onChange={(e) => setSrc(e.target.value)} placeholder="Source link (optional, makes your post count toward Source scout)" className="w-full rounded-lg border border-stone-300 bg-white p-2 text-xs" />
      {leaks.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          <b>Re-identification check:</b> {leaks.map((l) => `“${l.snippet}” — ${l.tip}`).join(" · ")}
        </div>
      )}
      {err && <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-800">{err}</div>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-xs text-slate-600">
          Post as:{" "}
          <select value={mode} onChange={(e) => setMode(e.target.value)} className="rounded-md border border-stone-300 bg-white px-1.5 py-1 text-xs">
            <option value="profile">my profile ({levelOptions.find((l) => l.id === profileLevel)?.name})</option>
            {levelOptions.filter((l) => l.id !== profileLevel).map((l) => <option key={l.id} value={l.id}>just this post: {l.name}</option>)}
          </select>
          <span className="ml-2 text-stone-400">→ {levelOptions.find((l) => l.id === eff)?.name}</span>
        </label>
        <button disabled={busy || body.trim().length < 8} onClick={send} className="rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40">{busy ? "Posting…" : "Post"}</button>
      </div>
    </div>
  );
}

export function Roundtable({ riskId, posts, canPost, levelOptions, profileLevel, isMod }: { riskId: string; posts: PostView[]; canPost: boolean; levelOptions: LevelOpt[]; profileLevel: string; isMod: boolean }) {
  const router = useRouter();
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const roots = posts.filter((p) => p.parentId === null);
  async function react(postId: number, type: string) {
    await fetch("/api/reactions", { method: "POST", body: JSON.stringify({ postId, type }) });
    router.refresh();
  }
  async function hide(postId: number) {
    await fetch("/api/mod/hide", { method: "POST", body: JSON.stringify({ postId }) });
    router.refresh();
  }
  const tone: Record<string, string> = { claim: "bg-sky-50 text-sky-800", evidence: "bg-emerald-50 text-emerald-800", counter: "bg-amber-50 text-amber-800", question: "bg-violet-50 text-violet-800", missing_risk: "bg-rose-50 text-rose-800" };

  const render = (p: PostView, depth: number) => (
    <div key={p.id} className={depth ? "ml-6 border-l-2 border-stone-200 pl-4" : ""}>
      <div className="rounded-xl border border-stone-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`rounded-full px-2 py-0.5 font-semibold ${tone[p.kind]}`}>{POST_KINDS[p.kind]}</span>
          <b className="text-sm text-slate-900">{p.who}</b>
          {p.sub && <span className="text-stone-500">{p.sub}</span>}
          <span className="rounded bg-stone-100 px-1.5 text-[10px] uppercase tracking-wide text-stone-500">{p.level === "named" ? "on the stage" : p.level}</span>
          <span className="text-stone-400">{p.when}</span>
          {isMod && <button onClick={() => hide(p.id)} className="ml-auto text-rose-600 hover:underline">hide</button>}
        </div>
        <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-800">{p.body}</p>
        {p.sourceUrl && <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 block break-all text-xs text-indigo-700 underline">{p.sourceUrl}</a>}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {Object.entries(REACTION_TYPES).map(([k, v]) => {
            const r = p.reactions[k] ?? { count: 0, mine: false };
            return (
              <button key={k} disabled={!canPost || p.self} onClick={() => react(p.id, k)} className={`rounded-full border px-2 py-0.5 text-xs disabled:cursor-default ${r.mine ? "border-teal-700 bg-teal-50 font-semibold text-teal-800" : "border-stone-200 text-stone-600 enabled:hover:bg-stone-50"}`}>
                {v.icon} {v.label} {r.count > 0 && <b>{r.count}</b>}
              </button>
            );
          })}
          {canPost && <button onClick={() => setReplyTo(replyTo === p.id ? null : p.id)} className="ml-auto text-xs font-semibold text-teal-700 hover:underline">Reply</button>}
        </div>
      </div>
      {replyTo === p.id && (
        <div className="mt-2 ml-6">
          <Composer riskId={riskId} parentId={p.id} levelOptions={levelOptions} profileLevel={profileLevel} defaultKind="counter" onDone={() => setReplyTo(null)} />
        </div>
      )}
      <div className="mt-2 space-y-2">{posts.filter((c) => c.parentId === p.id).map((c) => render(c, depth + 1))}</div>
    </div>
  );

  return (
    <div className="space-y-3">
      {roots.length === 0 && <p className="text-sm text-stone-500">No posts yet. Be the first to add evidence or a counter-view.</p>}
      {roots.map((p) => render(p, 0))}
      {canPost && (
        <div>
          <div className="mb-1 mt-4 text-sm font-semibold">Add to the Roundtable</div>
          <Composer riskId={riskId} levelOptions={levelOptions} profileLevel={profileLevel} defaultKind="claim" onDone={() => {}} />
        </div>
      )}
    </div>
  );
}
