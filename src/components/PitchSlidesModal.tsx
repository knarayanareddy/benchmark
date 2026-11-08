"use client";

import { useState, useEffect } from "react";

export function PitchSlidesModal() {
  const [cur, setCur] = useState<number>(-1);
  const [dots, setDots] = useState<string[]>([]);

  useEffect(() => {
    let kinds: string[] = [];
    for (let i = 0; i < 61; i++) kinds.push("yes");
    for (let i = 0; i < 43; i++) kinds.push("no");
    for (let i = 0; i < 35; i++) kinds.push("open");
    let s = 20261108;
    function rnd() {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    }
    for (let i = kinds.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = kinds[i];
      kinds[i] = kinds[j];
      kinds[j] = t;
    }
    setDots(kinds);

    const params = new URLSearchParams(window.location.search);
    if (params.get("slides") === "1" || params.get("slides") === "true") {
      setCur(0);
      return;
    }
    if (params.get("noslides") === "1") {
      setCur(-1);
      return;
    }
    const seen = sessionStorage.getItem("ground_truth_slides_seen");
    if (!seen && window.location.pathname === "/") {
      setCur(0);
    }
  }, []);

  useEffect(() => {
    if (cur === -1) return;
    const handleKey = (e: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        if (cur === 0) setCur(1);
        else if (cur === 1) closeSlides();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        if (cur === 1) setCur(0);
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeSlides();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [cur]);

  const closeSlides = () => {
    sessionStorage.setItem("ground_truth_slides_seen", "1");
    setCur(-1);
  };

  if (cur === -1) {
    return (
      <button
        onClick={() => setCur(0)}
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full bg-slate-900/90 text-amber-400 border border-amber-500/40 px-4 py-2 text-xs font-semibold shadow-2xl backdrop-blur transition hover:bg-slate-800 hover:scale-105"
        title="View 2-Slide Problem & Solution Pitch"
      >
        <span>📊</span>
        <span>Presentation Slides (2)</span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-between bg-[#0f1b2d] text-[#f4efe6] font-sans overflow-y-auto p-6 md:p-12 select-none">
      <div className="pointer-events-none absolute -top-40 right-0 h-[600px] w-[600px] rounded-full bg-[#1b3354]/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 left-0 h-[600px] w-[600px] rounded-full bg-[#17304f]/40 blur-3xl" />

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between border-b border-[#27405f] pb-4">
        <div className="flex items-center gap-3">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-600 font-bold text-white text-sm">◉</span>
          <div>
            <div className="text-[11px] font-mono uppercase tracking-widest text-amber-400 font-semibold">
              Hackathon for Good #8 · Challenge 2
            </div>
            <div className="text-sm font-bold text-slate-200">Ground Truth Circle × ACAPS</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex gap-2">
            <button
              onClick={() => setCur(0)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                cur === 0 ? "bg-amber-400 text-slate-950" : "bg-slate-800 text-slate-400 hover:text-white"
              }`}
            >
              1. The Problem
            </button>
            <button
              onClick={() => setCur(1)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                cur === 1 ? "bg-amber-400 text-slate-950" : "bg-slate-800 text-slate-400 hover:text-white"
              }`}
            >
              2. How We Solve It
            </button>
          </div>

          <button
            onClick={closeSlides}
            className="rounded-lg border border-[#27405f] bg-slate-800/80 px-3 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition"
          >
            Skip to Live Demo ✕
          </button>
        </div>
      </div>

      {/* Main Slide Content */}
      <div className="relative z-10 my-auto py-8">
        {cur === 0 && (
          <div className="grid gap-8 lg:grid-cols-12 items-center max-w-6xl mx-auto">
            <div className="lg:col-span-7 space-y-6">
              <div className="text-xs uppercase tracking-widest text-amber-400 font-bold font-mono">
                The Problem · Slide 1 of 2
              </div>
              <h1 className="font-serif text-3xl sm:text-5xl font-medium leading-tight text-white tracking-tight">
                In a crisis, the people who know the ground truth are hard to find,{" "}
                <em className="not-italic text-amber-400">hard to weigh, and often cannot speak freely.</em>
              </h1>
              <p className="text-base text-slate-300 leading-relaxed max-w-2xl">
                Where data is thin and access is limited, expert opinion is often the best signal there is. But it arrives unscored and unweighted, from people who may be at risk for what they say. Analysts cannot tell whose judgment holds up.
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
                <div>
                  <div className="font-serif text-3xl sm:text-4xl font-bold text-white">139</div>
                  <div className="text-xs text-slate-400 mt-1">risks on ACAPS radar</div>
                </div>
                <div>
                  <div className="font-serif text-3xl sm:text-4xl font-bold text-white">104</div>
                  <div className="text-xs text-slate-400 mt-1">have known outcome</div>
                </div>
                <div>
                  <div className="font-serif text-3xl sm:text-4xl font-bold text-rose-400">61</div>
                  <div className="text-xs text-slate-400 mt-1">materialised</div>
                </div>
                <div>
                  <div className="font-serif text-3xl sm:text-4xl font-bold text-teal-400">43</div>
                  <div className="text-xs text-slate-400 mt-1">did not</div>
                </div>
              </div>

              <div className="border-l-4 border-amber-400 bg-slate-900/60 p-4 rounded-r-xl text-xs sm:text-sm text-slate-200 space-y-1">
                <div>
                  The one place we can check: 104 ACAPS risks with known outcomes. Their ratings score <b>0.217</b> against <b>0.243</b> for always guessing the base rate. Better, but only about 1.6 standard errors apart: suggestive, not proven.
                </div>
                <div className="text-slate-400 text-xs">
                  Brier score, lower is better. Computed from the ACAPS risk radar export in our repository.
                </div>
              </div>

              <div className="flex gap-4 pt-2">
                <button
                  onClick={() => setCur(1)}
                  className="rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-6 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-amber-500/20 hover:scale-[1.02] active:scale-[0.98] transition"
                >
                  Next: How We Solve It →
                </button>
                <button
                  onClick={closeSlides}
                  className="rounded-xl border border-slate-700 bg-slate-800/60 px-5 py-3 text-sm font-semibold text-slate-300 hover:bg-slate-700 transition"
                >
                  Continue Directly to Live Demo ↗
                </button>
              </div>
            </div>

            <div className="lg:col-span-5 space-y-4">
              <div className="grid grid-cols-20 gap-1.5 p-4 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl">
                {dots.map((kind, idx) => (
                  <div
                    key={idx}
                    className={`aspect-square rounded-full transition-all duration-300 ${
                      kind === "yes"
                        ? "bg-[#ef6f5e]"
                        : kind === "no"
                        ? "bg-[#4fd1b5]"
                        : "bg-[#34507a]"
                    }`}
                  />
                ))}
              </div>
              <div className="flex justify-end gap-4 text-xs text-slate-400 flex-wrap">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#ef6f5e]" /> materialised (61)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#4fd1b5]" /> did not (43)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#34507a]" /> open / unscored (35)
                </span>
              </div>
            </div>
          </div>
        )}

        {cur === 1 && (
          <div className="space-y-8 max-w-6xl mx-auto">
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-widest text-amber-400 font-bold font-mono">
                How We Solve It · Slide 2 of 2
              </div>
              <h1 className="font-serif text-3xl sm:text-5xl font-medium leading-tight text-white tracking-tight">
                Ninety seconds from each expert,{" "}
                <em className="not-italic text-amber-400">scored when reality answers.</em>
              </h1>
              <p className="text-base text-slate-300 max-w-3xl">
                An invitation-only circle of humanitarian experts forecasts short, resolvable questions drawn from ACAPS&apos;s own risks.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 space-y-2">
                <div className="font-serif text-2xl font-bold text-amber-400">1</div>
                <h3 className="font-bold text-white text-base">Ask</h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  A risk becomes a precise question with a window and a public source that will settle it, sent to experts who know that country or theme.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 space-y-2">
                <div className="font-serif text-2xl font-bold text-amber-400">2</div>
                <h3 className="font-bold text-white text-base">Estimate, blind</h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Each expert gives a probability before seeing ACAPS&apos;s reading or anyone else&apos;s.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 space-y-2">
                <div className="font-serif text-2xl font-bold text-amber-400">3</div>
                <h3 className="font-bold text-white text-base">See the picture</h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  The circle&apos;s pooled range, ACAPS&apos;s reading and your own mark, side by side. You may revise.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 space-y-2">
                <div className="font-serif text-2xl font-bold text-amber-400">4</div>
                <h3 className="font-bold text-white text-base">Resolve and score</h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  When the source settles it, each forecast can be scored against the outcome, so reliability is measured, not assumed.
                </p>
              </div>
            </div>

            <div className="grid lg:grid-cols-12 gap-8 items-center bg-slate-900/60 border border-slate-800 p-6 rounded-2xl">
              <div className="lg:col-span-7 space-y-4">
                <div className="relative h-16 flex items-center">
                  <div className="absolute left-0 right-0 h-1.5 bg-slate-800 rounded-full" />
                  <div
                    className="absolute h-6 rounded-full bg-teal-500/20 border border-teal-400"
                    style={{ left: "44%", width: "22%" }}
                  />
                  <div className="absolute flex flex-col items-center" style={{ left: "20%" }}>
                    <span className="text-[10px] font-bold text-blue-400 mb-1">ACAPS</span>
                    <div className="h-8 w-0.5 bg-blue-400 rounded-full" />
                  </div>
                  <div className="absolute flex flex-col items-center" style={{ left: "55%" }}>
                    <span className="text-[10px] font-bold text-teal-400 mb-1">Circle</span>
                    <div className="h-8 w-0.5 bg-teal-400 rounded-full" />
                  </div>
                  <div className="absolute flex flex-col items-center" style={{ left: "30%" }}>
                    <span className="text-[10px] font-bold text-amber-400 mb-1">You</span>
                    <div className="h-8 w-0.5 bg-amber-400 rounded-full" />
                  </div>
                </div>
                <div className="flex justify-between text-[11px] font-mono text-slate-500">
                  <span>0%</span>
                  <span>25%</span>
                  <span>50%</span>
                  <span>75%</span>
                  <span>100%</span>
                </div>
              </div>

              <div className="lg:col-span-5 space-y-3">
                <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold font-mono">
                  Built for people at risk
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-200">
                    Invitation-only
                  </span>
                  <span className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-200">
                    Three privacy levels
                  </span>
                  <span className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-200">
                    Results shown only when 5+ answer
                  </span>
                  <span className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-200">
                    Simulated numbers always labelled
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 pt-2">
              <button
                onClick={closeSlides}
                className="rounded-xl bg-gradient-to-r from-teal-400 via-emerald-400 to-teal-500 px-8 py-4 text-base font-bold text-slate-950 shadow-xl shadow-teal-500/20 hover:scale-[1.02] active:scale-[0.98] transition"
              >
                Continue to Live Demo ⚡ (ground-truth-circle.onrender.com) →
              </button>
              <button
                onClick={() => setCur(0)}
                className="rounded-xl border border-slate-700 bg-slate-800/60 px-5 py-3 text-sm font-semibold text-slate-300 hover:bg-slate-700 transition"
              >
                ← Back to Slide 1
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer navigation */}
      <div className="relative z-10 flex items-center justify-between border-t border-[#27405f] pt-4 text-xs text-slate-400">
        <div>Ground Truth Circle · Challenge 2 Pitch Deck</div>
        <div className="font-mono text-slate-500">
          ← → / Space flips slides · Esc or button closes to Live Demo
        </div>
        <div className="rounded-md border border-[#3a5478] px-2 py-0.5 font-mono text-slate-300">
          Slide {cur + 1} of 2
        </div>
      </div>
    </div>
  );
}
