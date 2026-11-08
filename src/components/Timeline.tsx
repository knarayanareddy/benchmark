import React from "react";
import { StepChart } from "./StepChart";
import type { Timeline as TimelineData } from "@/lib/timeline";
import { Pill } from "./ui";

export const TIMELINE_CAPTION =
  "Dates and values as recorded by ACAPS analysts. Completion rate is a judgement whose meaning has not been standardised.";

const TREND_TONE: Record<string, "rose" | "green" | "stone" | "amber"> = {
  Deteriorated: "rose",
  Improved: "green",
  Stable: "stone",
};

/** Newest first; an update with no date (text before the first dated header) goes last. Equal dates keep the file order. */
const newestFirst = (
  updates: Array<{ date: string | null; text: string }>
) =>
  [...updates].sort((a, b) =>
    (b.date ?? "") < (a.date ?? "")
      ? -1
      : (b.date ?? "") > (a.date ?? "")
      ? 1
      : 0
  );

/**
 * How a risk has been recorded to change. Shows only what ACAPS recorded, with its dates:
 * no durations or lags are computed, and completion rate is never treated as a probability.
 * Never rendered for a neutral/locked view.
 */
export function Timeline({ timeline }: { timeline?: TimelineData | null }) {
  if (!timeline) return null;
  const triggers = (timeline.triggers ?? []).filter(
    (t) => (t.completion?.length ?? 0) > 0 || (t.trend?.length ?? 0) > 0
  );
  const updates = newestFirst(timeline.rationaleUpdates ?? []);

  return (
    <section
      className="space-y-4 rounded-2xl border border-stone-200/90 bg-white p-5 shadow-sm"
      aria-labelledby="tl-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="tl-heading" className="font-serif text-xl font-semibold text-slate-900">
            How this risk has been recorded to change
          </h3>
          <p className="mt-0.5 text-xs text-stone-600">{TIMELINE_CAPTION}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {timeline.riskTrend && (
            <Pill tone={TREND_TONE[timeline.riskTrend] ?? "stone"}>
              Risk trend: {timeline.riskTrend}
            </Pill>
          )}
          {timeline.span && (
            <Pill tone="teal">
              Span: {timeline.span.from} → {timeline.span.to} ({timeline.points}{" "}
              {timeline.points === 1 ? "entry" : "entries"})
            </Pill>
          )}
        </div>
      </div>

      {triggers.length === 0 && updates.length === 0 && (
        <p className="rounded-lg bg-stone-50 p-3 text-sm text-stone-600">
          ACAPS has recorded no dated changes for this risk in the current export.
        </p>
      )}

      {triggers.length > 0 && (
        <div className="space-y-4">
          <h4 className="text-xs font-semibold tracking-wider text-stone-500 uppercase">
            Recorded Trigger Histories ({triggers.length})
          </h4>
          {triggers.map((t, i) => {
            const readings = (t.completion?.length ?? 0) + (t.trend?.length ?? 0);
            return (
              <article
                key={t.id ?? i}
                className="space-y-2.5 rounded-xl border border-stone-200 bg-stone-50/70 p-3.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h5 className="text-sm font-semibold text-slate-900">
                    <span className="mr-1.5 font-mono text-xs text-stone-500">{t.id}</span>
                    {t.title}
                  </h5>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
                    {t.dateEntered && <span>Entered: {t.dateEntered}</span>}
                    {t.lastUpdate && <span>· Last update: {t.lastUpdate}</span>}
                    {t.movement.completion !== "none" && (
                      <Pill
                        tone={
                          t.movement.completion === "up"
                            ? "amber"
                            : t.movement.completion === "down"
                            ? "teal"
                            : "stone"
                        }
                      >
                        Completion movement: {t.movement.completion}
                      </Pill>
                    )}
                  </div>
                </div>

                {t.completion?.length > 0 && (
                  <StepChart
                    title={`Completion rate: ${t.title}`}
                    points={t.completion}
                    yMin={0}
                    yMax={100}
                    unit="%"
                  />
                )}

                {readings === 1 && (
                  <p className="text-xs text-stone-500 italic">
                    One reading, no movement to show
                  </p>
                )}

                {t.trend?.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-stone-600">
                      Recorded trigger trend markers:
                    </div>
                    <ul
                      className="flex flex-wrap items-center gap-2"
                      aria-label={`Trend: ${t.title}`}
                    >
                      {t.trend.map((p, j) => (
                        <li
                          key={j}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-xs"
                        >
                          <Pill tone={TREND_TONE[p.value] ?? "stone"}>{p.value}</Pill>
                          <time dateTime={p.date} className="font-mono text-stone-700">
                            {p.date}
                          </time>
                          {p.conflict && (
                            <span className="text-amber-700">
                              same day, order as recorded
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {updates.length > 0 && (
        <div className="space-y-2.5">
          <h4 className="text-xs font-semibold tracking-wider text-stone-500 uppercase">
            Dated Rationale Updates ({updates.length})
          </h4>
          <ol className="space-y-2">
            {updates.map((u, i) => (
              <li
                key={i}
                className="rounded-xl border border-stone-200 bg-stone-50/70 p-3 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <time
                    dateTime={u.date ?? undefined}
                    className="font-mono text-xs font-semibold text-teal-800"
                  >
                    {u.date ? `UPDATE ${u.date}` : "Undated baseline entry"}
                  </time>
                  <span className="text-xs text-stone-500">As recorded by ACAPS</span>
                </div>
                <details className="mt-1.5 group" open={i === 0}>
                  <summary className="cursor-pointer text-xs font-medium text-teal-700 hover:underline">
                    Show this update
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                    {u.text}
                  </p>
                </details>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
