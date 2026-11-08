"use client";

import React, { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { THEMES } from "@/lib/constants";
import { TEXT_MIN, TEXT_MAX, downstream } from "@/lib/links";
import type { GridResult } from "@/lib/grid";
import { Card, Pill } from "./ui";

export type EvolutionCardItem = {
  id: string;
  questionId: number;
  riskId: string;
  country: string;
  region: string | null;
  theme: string | null;
  statement: string;
  status: string;
  round: number;
  closedRounds: number[];
  kind: string;
  respondents: number;
};

export type SeriesPayload = {
  cardId: string;
  questionId: number;
  statement: string;
  status: string;
  round: number;
  closedRounds: number[];
  points: Array<{
    round: number;
    day: string;
    n: number;
    estimate: number;
    lo: number;
    hi: number;
  }>;
  withheld: Array<{ round: number }>;
  note: string;
};

export type LinkItem = {
  id: string;
  fromCardId: string;
  toCardId: string;
  fromStatement: string | null;
  toStatement: string | null;
  mechanism: string;
  rival: string;
  by: string;
  day: string;
};

const pct = (p: number) => `${Math.round(p * 1000) / 10}%`;
const clamp01 = (p: number) => Math.min(1, Math.max(0, p));
const themeLabel = (k: string) => THEMES[k] ?? k;

function IntervalBar({
  lo,
  hi,
  estimate,
}: {
  lo: number;
  hi: number;
  estimate: number;
}) {
  const w = 140;
  return (
    <svg
      className="ml-2 inline-block h-3.5 w-36 align-middle"
      viewBox={`0 0 ${w} 14`}
      aria-hidden="true"
      focusable="false"
    >
      <line
        stroke="#e7e5e4"
        strokeWidth="3"
        strokeLinecap="round"
        x1={0}
        x2={w}
        y1={7}
        y2={7}
      />
      <line
        stroke="#0f766e"
        strokeWidth="4"
        strokeLinecap="round"
        x1={clamp01(lo) * w}
        x2={clamp01(hi) * w}
        y1={7}
        y2={7}
      />
      <circle
        fill="#0f766e"
        stroke="#ffffff"
        strokeWidth="1.5"
        cx={clamp01(estimate) * w}
        cy={7}
        r={4.5}
      />
    </svg>
  );
}

function Mechanism({ text, rival }: { text: string; rival?: string }) {
  return (
    <div className="mt-1 space-y-1 text-xs text-slate-700">
      {text.length <= 120 ? (
        <p className="text-stone-600">
          <b className="text-slate-800">Mechanism:</b> {text}
        </p>
      ) : (
        <details open>
          <summary className="cursor-pointer font-medium text-teal-800">
            Mechanism
          </summary>
          <p className="mt-0.5 text-stone-600">{text}</p>
        </details>
      )}
      {rival && (
        <p className="text-stone-600">
          <b className="text-slate-800">Rival explanation:</b> {rival}
        </p>
      )}
    </div>
  );
}

export function EvolutionConsole({
  initialCards,
  initialSeries,
  initialGrid,
  initialLinks,
  initialChainCardId,
  moderator,
}: {
  initialCards: EvolutionCardItem[];
  initialSeries: SeriesPayload | null;
  initialGrid: GridResult;
  initialLinks: LinkItem[];
  initialChainCardId: string;
  moderator: boolean;
}) {
  const [cards] = useState<EvolutionCardItem[]>(initialCards);
  const [cardId, setCardId] = useState<string>(initialSeries?.cardId ?? "");
  const [series, setSeries] = useState<SeriesPayload | null>(initialSeries);
  const [seriesError, setSeriesError] = useState<string>("");
  const [closingRound, setClosingRound] = useState<boolean>(false);
  const seq = useRef(0);

  const [links, setLinks] = useState<LinkItem[]>(initialLinks);
  const [removing, setRemoving] = useState<string>("");
  const [removeError, setRemoveError] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [mechanism, setMechanism] = useState<string>("");
  const [rival, setRival] = useState<string>("");
  const [formError, setFormError] = useState<string>("");
  const [formOk, setFormOk] = useState<string>("");
  const [chainCard, setChainCard] = useState<string>(initialChainCardId);
  const [chainOpen, setChainOpen] = useState<boolean>(Boolean(initialChainCardId));

  async function chooseCard(id: string) {
    const my = ++seq.current;
    setCardId(id);
    setSeries(null);
    setSeriesError("");
    if (!id) return;
    try {
      const res = await fetch(
        `/api/staff/cards/${encodeURIComponent(id)}/series`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load series");
      if (my === seq.current) setSeries(data);
    } catch (e) {
      if (my === seq.current) {
        setSeriesError(e instanceof Error ? e.message : "Error loading series");
      }
    }
  }

  async function closeActiveRound() {
    if (!cardId) return;
    setClosingRound(true);
    setSeriesError("");
    try {
      const res = await fetch(
        `/api/staff/cards/${encodeURIComponent(cardId)}/series`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not close round");
      setSeries(data);
    } catch (e) {
      setSeriesError(e instanceof Error ? e.message : "Failed to close round");
    } finally {
      setClosingRound(false);
    }
  }

  const rows = useMemo(() => {
    if (!series) return [];
    return [
      ...series.points.map((p) => ({ ...p, withheld: false as const })),
      ...series.withheld.map((w) => ({
        round: w.round,
        withheld: true as const,
      })),
    ].sort((a, b) => a.round - b.round);
  }, [series]);

  const statements = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cards) m.set(c.id, c.statement);
    for (const l of links) {
      if (l.fromStatement) m.set(l.fromCardId, l.fromStatement);
      if (l.toStatement) m.set(l.toCardId, l.toStatement);
    }
    return m;
  }, [cards, links]);

  const label = (id: string) => statements.get(id) ?? id;
  const chain = useMemo(
    () => (chainOpen && chainCard ? downstream(links, chainCard, { maxDepth: 3 }) : []),
    [chainOpen, chainCard, links]
  );

  async function reloadLinks() {
    const res = await fetch("/api/staff/links");
    if (res.ok) {
      setLinks(await res.json());
    }
  }

  async function createLink(e: React.FormEvent) {
    e.preventDefault();
    const m = mechanism.trim();
    const r = rival.trim();
    const issues: string[] = [];
    if (!from || !to) {
      issues.push("Choose the card the link comes from and the card it leads to.");
    } else if (from === to) {
      issues.push("Choose two different cards.");
    }
    if (m.length < TEXT_MIN || m.length > TEXT_MAX) {
      issues.push(
        `The mechanism needs ${TEXT_MIN} to ${TEXT_MAX} characters; it has ${m.length}.`
      );
    }
    if (r.length < TEXT_MIN || r.length > TEXT_MAX) {
      issues.push(
        `The rival explanation needs ${TEXT_MIN} to ${TEXT_MAX} characters; it has ${r.length}.`
      );
    }
    setFormOk("");
    if (issues.length) {
      setFormError(issues.join(" "));
      return;
    }
    setFormError("");
    try {
      const res = await fetch("/api/staff/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromCardId: from,
          toCardId: to,
          mechanism: m,
          rival: r,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to record link");
      }
      setFrom("");
      setTo("");
      setMechanism("");
      setRival("");
      setFormOk("Link recorded.");
      await reloadLinks();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to record link");
    }
  }

  async function removeLink(id: string) {
    setRemoveError("");
    try {
      const res = await fetch(`/api/staff/links/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to remove link");
      await reloadLinks();
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : "Failed to remove link");
    }
    setRemoving("");
  }

  const gridCell = (region: string, theme: string) =>
    initialGrid.cells.find((c) => c.region === region && c.theme === theme);

  return (
    <div className="space-y-8">
      {/* 1. PANEL OVER THE ROUNDS */}
      <Card>
        <section aria-labelledby="ev-panel-h" className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 id="ev-panel-h" className="font-serif text-xl font-semibold">
                Panel over the rounds
              </h2>
              <p className="text-sm text-slate-600">
                Each round with its estimate and interval. A round with fewer than 5
                respondents is withheld and shows no numbers. Only closed rounds are
                shown to prevent sequential differencing.
              </p>
            </div>
            <Pill tone="teal">Release floor: n ≥ 5</Pill>
          </div>

          <div className="max-w-2xl">
            <label
              htmlFor="ev-card"
              className="mb-1 block text-xs font-semibold tracking-wider text-stone-500 uppercase"
            >
              Card
            </label>
            <select
              id="ev-card"
              value={cardId}
              onChange={(e) => chooseCard(e.target.value)}
              className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus:border-teal-700 focus:outline-hidden"
            >
              <option value="">Choose a card</option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {`${c.id} (${c.respondents} resp${
                    c.respondents < 5 ? " · <5 floor" : ""
                  }): ${c.statement.slice(0, 110)}`}
                </option>
              ))}
            </select>
          </div>

          {seriesError && (
            <div
              role="alert"
              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"
            >
              {seriesError}
            </div>
          )}

          {series && (
            <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    {series.statement}
                  </h3>
                  <p className="text-xs text-stone-500">
                    Card ID: <b className="font-mono">{series.cardId}</b> · Status:{" "}
                    <b>{series.status}</b>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/q/${series.questionId}`}
                    className="rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-stone-100"
                  >
                    Open question page →
                  </Link>
                  {moderator &&
                    (!series.closedRounds?.includes(1) ||
                      !series.closedRounds?.includes(2)) && (
                      <button
                        type="button"
                        disabled={closingRound}
                        onClick={closeActiveRound}
                        className="rounded-lg bg-teal-700 px-3 py-1 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                      >
                        {closingRound
                          ? "Closing round…"
                          : `Close Round ${
                              !series.closedRounds?.includes(1) ? 1 : 2
                            } & snapshot to ledger`}
                      </button>
                    )}
                </div>
              </div>

              {rows.length === 0 ? (
                <p className="text-sm text-stone-500">No rounds to show yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table
                    className="w-full text-left text-sm"
                    aria-label="Rounds for this card"
                  >
                    <thead>
                      <tr className="border-b border-stone-200 text-xs text-stone-500">
                        <th scope="col" className="py-2 pr-4 font-semibold">
                          Round
                        </th>
                        <th scope="col" className="py-2 pr-4 font-semibold">
                          Day
                        </th>
                        <th scope="col" className="py-2 pr-4 font-semibold">
                          Experts
                        </th>
                        <th scope="col" className="py-2 font-semibold">
                          Estimate and interval
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) =>
                        r.withheld ? (
                          <tr
                            key={`w${r.round}`}
                            className="border-b border-stone-200 bg-amber-50/70 text-amber-900"
                          >
                            <td colSpan={4} className="py-2.5 px-2 text-xs font-medium">
                              {`Round ${r.round}: withheld, fewer than 5 respondents`}
                            </td>
                          </tr>
                        ) : (
                          <tr
                            key={r.round}
                            className="border-b border-stone-200 last:border-0"
                          >
                            <td className="py-2.5 pr-4 font-medium">
                              {`Round ${r.round}`}
                            </td>
                            <td className="py-2.5 pr-4 font-mono text-xs text-stone-600">
                              {r.day}
                            </td>
                            <td className="py-2.5 pr-4 text-xs text-stone-700">
                              {`${r.n} experts`}
                            </td>
                            <td className="py-2.5">
                              <strong className="font-serif text-base text-teal-900">
                                {pct(r.estimate)}
                              </strong>{" "}
                              <span className="text-xs text-stone-500">
                                {`interval ${pct(r.lo)} to ${pct(r.hi)}`}
                              </span>
                              <IntervalBar
                                lo={r.lo}
                                hi={r.hi}
                                estimate={r.estimate}
                              />
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {series.note && (
                <p className="text-xs text-stone-500 italic">{series.note}</p>
              )}
            </div>
          )}
        </section>
      </Card>

      {/* 2. REGIONAL GRID */}
      <Card>
        <section aria-labelledby="ev-grid-h" className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 id="ev-grid-h" className="font-serif text-xl font-semibold">
                Regional grid
              </h2>
              <p className="text-sm text-slate-600">
                {`Cells with fewer than ${
                  initialGrid.minCell ?? 10
                } risks are descriptive only; no association is implied.`}
              </p>
            </div>
            <Pill>Counts of radar risks &amp; cards only · zero expert data</Pill>
          </div>

          <div
            className="overflow-x-auto rounded-xl border border-stone-200"
            role="region"
            aria-label="Regional grid, scrolls sideways on a small screen"
            tabIndex={0}
          >
            <table
              className="w-full border-collapse text-left text-xs"
              aria-label="Risks and cards by region and theme"
            >
              <thead>
                <tr className="border-b border-stone-200 bg-stone-100/80 text-stone-600">
                  <th scope="col" className="p-2.5 font-semibold">
                    Region
                  </th>
                  {initialGrid.themes.map((t) => (
                    <th key={t} scope="col" className="p-2.5 font-semibold">
                      {themeLabel(t)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {initialGrid.regions.map((r) => (
                  <tr key={r} className="border-b border-stone-200 last:border-0">
                    <th
                      scope="row"
                      className="bg-stone-50/70 p-2.5 font-semibold text-slate-900"
                    >
                      {r}
                    </th>
                    {initialGrid.themes.map((t) => {
                      const c = gridCell(r, t);
                      return (
                        <td
                          key={t}
                          className={`p-2.5 align-top ${
                            c?.small ? "bg-stone-50/40 text-stone-600" : "bg-white font-medium text-slate-900"
                          }`}
                          title={c?.small ? "descriptive only" : undefined}
                        >
                          {!c ? (
                            "—"
                          ) : (
                            <div className="flex flex-col items-start gap-1">
                              <span>
                                <b className="text-slate-900">{c.risks}</b>{" "}
                                {c.risks === 1 ? "risk" : "risks"}
                              </span>
                              {c.cards > 0 && (
                                <span className="text-teal-800">
                                  {`${c.cards} ${
                                    c.cards === 1 ? "card" : "cards"
                                  } (${c.live} live)`}
                                </span>
                              )}
                              {c.small && (
                                <span className="rounded-md bg-stone-200/80 px-1.5 py-0.5 text-[10px] font-medium text-stone-700">
                                  descriptive only
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </Card>

      {/* 3. LINKED QUESTIONS (ANALYST JUDGEMENT) */}
      <Card>
        <section aria-labelledby="ev-links-h" className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 id="ev-links-h" className="font-serif text-xl font-semibold">
                Linked questions (analyst judgement)
              </h2>
              <p className="text-sm text-slate-600">
                A link says one question may bear on another, by the mechanism stated
                and against the rival explanation. A link is not a finding, and
                nothing is linked automatically.
              </p>
            </div>
            <Pill tone="amber">Analyst judgement, not a finding</Pill>
          </div>

          {removeError && (
            <div
              role="alert"
              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"
            >
              {removeError}
            </div>
          )}

          {/* DOWNSTREAM TRICKLE-DOWN EXPLORER */}
          <div className="rounded-xl border border-teal-200 bg-teal-50/40 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-serif text-lg font-semibold text-slate-900">
                  Downstream of a card (trickle-down chain){" "}
                  <Pill tone="amber">Analyst judgement, not a finding</Pill>
                </h3>
                <p className="text-xs text-stone-600">
                  Follows the analyst-recorded links from a root situation or question,
                  up to three steps (`maxDepth = 3`), with cycle protection.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[280px] flex-1">
                <label
                  htmlFor="ev-chain-card"
                  className="mb-1 block text-xs font-semibold text-stone-600"
                >
                  Card to follow
                </label>
                <select
                  id="ev-chain-card"
                  value={chainCard}
                  onChange={(e) => {
                    setChainCard(e.target.value);
                    if (e.target.value) setChainOpen(true);
                  }}
                  className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-slate-900"
                >
                  <option value="">Choose a card</option>
                  {cards.map((c) => (
                    <option key={c.id} value={c.id}>
                      {`${c.id}: ${c.statement.slice(0, 110)}`}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                aria-expanded={chainOpen}
                disabled={!chainCard}
                onClick={() => setChainOpen(!chainOpen)}
                className="rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-stone-100 disabled:opacity-50"
              >
                {chainOpen ? "Hide downstream" : "Show downstream"}
              </button>
            </div>

            {chainOpen &&
              chainCard &&
              (chain.length === 0 ? (
                <p className="text-sm text-stone-600">
                  No links lead on from this card.
                </p>
              ) : (
                <ol className="space-y-2.5 pt-1">
                  {chain.map((c) => (
                    <li
                      key={c.cardId}
                      className="rounded-xl border border-stone-200 bg-white p-3 shadow-2xs"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Pill tone="teal">{`Step ${c.depth}`}</Pill>
                        <span className="font-mono font-semibold text-slate-800">
                          {c.via} → {c.cardId}
                        </span>
                        <Pill tone="amber">Analyst judgement, not a finding</Pill>
                      </div>
                      <p className="mt-1 text-sm font-semibold text-slate-900">
                        {`Step ${c.depth}: ${label(c.cardId)}`}
                      </p>
                      <p className="text-xs text-stone-500">
                        {`After: ${label(c.via)}`}
                      </p>
                      <Mechanism text={c.mechanism} rival={c.rival} />
                    </li>
                  ))}
                </ol>
              ))}
          </div>

          {/* RECORDED LINKS LIST */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold tracking-wider text-stone-500 uppercase">
              Recorded Analyst Links ({links.length})
            </h3>
            {links.length === 0 ? (
              <p className="text-sm text-stone-500">No links recorded yet.</p>
            ) : (
              <ul className="space-y-3">
                {links.map((l) => (
                  <li
                    key={l.id}
                    className="rounded-xl border border-stone-200 bg-stone-50/60 p-4 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill tone="amber">Analyst judgement, not a finding</Pill>
                        <span className="font-mono text-xs font-semibold text-teal-800">
                          {l.fromCardId} → {l.toCardId}
                        </span>
                      </div>
                      <span className="text-xs text-stone-500">
                        {`Recorded by ${l.by} on ${l.day}`}
                      </span>
                    </div>

                    <p className="text-sm text-slate-900">
                      <strong>From ({l.fromCardId}):</strong>{" "}
                      {l.fromStatement ?? l.fromCardId}
                    </p>
                    <p className="text-sm text-slate-900">
                      <strong>To ({l.toCardId}):</strong>{" "}
                      {l.toStatement ?? l.toCardId}
                    </p>
                    <div className="grid gap-2 pt-1 md:grid-cols-2">
                      <div className="rounded-lg border border-stone-200 bg-white p-2.5 text-xs text-slate-700">
                        <strong className="block text-slate-900">
                          Stated mechanism:
                        </strong>
                        {l.mechanism}
                      </div>
                      <div className="rounded-lg border border-stone-200 bg-white p-2.5 text-xs text-slate-700">
                        <strong className="block text-slate-900">
                          Rival explanation:
                        </strong>
                        {l.rival}
                      </div>
                    </div>

                    {moderator &&
                      (removing === l.id ? (
                        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                          <span className="font-medium text-rose-800">
                            Remove this link?
                          </span>
                          <button
                            type="button"
                            onClick={() => removeLink(l.id)}
                            className="rounded-lg bg-rose-700 px-2.5 py-1 font-semibold text-white hover:bg-rose-800"
                          >
                            Yes, remove this link
                          </button>
                          <button
                            type="button"
                            onClick={() => setRemoving("")}
                            className="rounded-lg border border-stone-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-stone-100"
                          >
                            Keep it
                          </button>
                        </div>
                      ) : (
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={() => setRemoving(l.id)}
                            className="rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-stone-100"
                          >
                            Remove link
                          </button>
                        </div>
                      ))}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* RECORD A NEW LINK FORM */}
          {moderator && (
            <form
              onSubmit={createLink}
              noValidate
              aria-labelledby="ev-new-h"
              className="space-y-4 rounded-xl border border-stone-300 bg-stone-50 p-4"
            >
              <div>
                <h3 id="ev-new-h" className="font-serif text-lg font-semibold">
                  Record a link
                </h3>
                <p className="text-xs text-stone-600">
                  Name the mechanism and a rival explanation ({TEXT_MIN}–{TEXT_MAX}{" "}
                  characters each). Both are required so cross-risk links never become
                  unexamined causal claims.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label
                    htmlFor="lk-from"
                    className="mb-1 block text-xs font-semibold text-stone-700"
                  >
                    From card (required)
                  </label>
                  <select
                    id="lk-from"
                    required
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Choose a card</option>
                    {cards.map((c) => (
                      <option key={c.id} value={c.id}>
                        {`${c.id}: ${c.statement.slice(0, 100)}`}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="lk-to"
                    className="mb-1 block text-xs font-semibold text-stone-700"
                  >
                    To card (required)
                  </label>
                  <select
                    id="lk-to"
                    required
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Choose a card</option>
                    {cards.map((c) => (
                      <option key={c.id} value={c.id}>
                        {`${c.id}: ${c.statement.slice(0, 100)}`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="lk-mech"
                  className="mb-1 block text-xs font-semibold text-stone-700"
                >
                  Mechanism (required)
                </label>
                <textarea
                  id="lk-mech"
                  required
                  rows={2}
                  aria-describedby="lk-mech-count"
                  value={mechanism}
                  onChange={(e) => setMechanism(e.target.value)}
                  placeholder="State the concrete pathway by which the upstream situation drives or constrains the downstream question…"
                  className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                />
                <p id="lk-mech-count" className="mt-0.5 text-xs text-stone-500">
                  {`${mechanism.trim().length} of ${TEXT_MAX} characters; at least ${TEXT_MIN} needed.`}
                </p>
              </div>

              <div>
                <label
                  htmlFor="lk-rival"
                  className="mb-1 block text-xs font-semibold text-stone-700"
                >
                  Rival explanation (required)
                </label>
                <textarea
                  id="lk-rival"
                  required
                  rows={2}
                  aria-describedby="lk-rival-count"
                  value={rival}
                  onChange={(e) => setRival(e.target.value)}
                  placeholder="State a plausible alternative explanation or why the downstream outcome could move independently…"
                  className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                />
                <p id="lk-rival-count" className="mt-0.5 text-xs text-stone-500">
                  {`${rival.trim().length} of ${TEXT_MAX} characters; at least ${TEXT_MIN} needed.`}
                </p>
              </div>

              {formError && (
                <div
                  role="alert"
                  className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
                >
                  {formError}
                </div>
              )}
              {formOk && (
                <div
                  role="status"
                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
                >
                  {formOk}
                </div>
              )}

              <div>
                <button
                  type="submit"
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  Record link
                </button>
              </div>
            </form>
          )}
        </section>
      </Card>
    </div>
  );
}
