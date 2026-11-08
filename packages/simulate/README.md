# The pilot power simulator

This folder holds the simulator behind the power analysis for the ACAPS pilot. It answers questions such as: how many risk questions and how many responders does the pilot need before a panel's forecasts could be shown to beat ACAPS's own ratings? It also covers round 2, correlation between questions, calibration, and how much each assumption matters.

## Every output is synthetic

**Every number this simulator produces is a simulation under stated assumptions, not a result.** The simulated risks, experts and answers are invented. Nothing here says anything about a real risk, a real panel, or ACAPS's real performance.

- Every output file is labelled `SYNTHETIC: simulation under stated assumptions, not a result`.
- Do not quote a number from this folder as a finding. If you need to say what the simulator shows, say it shows what the pilot design *could* detect under the assumptions in [`docs/15-judgement-calls.md`](../../docs/15-judgement-calls.md).
- Files named `REAL-…` are built only from the historical records (the radar export in `data/`). They are not simulated, and the label says so.

## Commands

Run these from the repository root.

| Command | What it does | Time |
| --- | --- | --- |
| `npm run simulate` | Full study: validation, calendar, power, round 2, second-stage rules, correlation, calibration, sensitivity sweeps, then writes all outputs. | Up to 9 minutes (time budget 540 s). |
| `npm run simulate:quick` | The same study with fewer replicates and wider error bars. | Up to 90 seconds (time budget). |
| `npm test` | Fast tests for the simulator and the rest of the repo. | Well under 20 seconds. |
| `npm run test:slow` | Slower tests: the Monte Carlo checks and an end-to-end quick run. | About a minute or more. |

If a run uses up its time budget, it skips the remaining sections, prints where it stopped, and says so in the manifest. The run exits with an error if any validation check fails.

Options for the run script (call it directly with `node packages/simulate/bin/run.mjs`): `--quick`, `--seed N` (default 20261107), and `--out DIR` to write somewhere other than the default.

## Where the outputs go

Outputs are written to `packages/simulate/out/<run id>/`, for example `out/20261107-seed20261107-quick/`. The run id holds the date, the seed and whether it was a quick run. This folder is git-ignored, so outputs are not committed.

Start with these files in a run folder:

- `SYNTHETIC-report.md`: the report, with each section and its numbers.
- `SYNTHETIC-validation.md`: the checks that the simulator passes or fails, with what each one tests.
- `SYNTHETIC-manifest.json`: the seed, the run settings, the time budget and what was skipped, and the assumptions in force.
- `SYNTHETIC-*.csv` and `SYNTHETIC-*.svg`: the tables and figures named after their section.
- `REAL-*.csv` and `REAL-*.svg`: summaries of the historical records only.

## Changing an assumption

Every number the study chooses rather than measures is a judgement call. Each one is listed in `assumptions.json` and explained in `docs/15-judgement-calls.md`.

1. Open `packages/simulate/assumptions.json` and find the entry whose `keys` include the setting you want to change. Edit its `value`. The file is checked when it is loaded, and a bad file stops the run with every problem listed.
2. Record who decided and when in that entry's `review` block: set `state` to `accepted`, `changed` or `vetoed`, and fill in `by`, `date` (YYYY-MM-DD) and `note`. The register says that nothing changes until a change is recorded this way.
3. Regenerate the register:

   ```sh
   node packages/simulate/bin/make-register.mjs --write-docs
   ```

   This rewrites `docs/15-judgement-calls.md` and writes `packages/simulate/out/register/SYNTHETIC-register.md`.
4. Check that the register matches the file and that every key is covered:

   ```sh
   node packages/simulate/bin/check-register.mjs
   ```

   It exits with an error and lists each problem if the register is stale or a key is missing.
5. Run the study again (`npm run simulate:quick` or `npm run simulate`). Outputs do not update on their own.

Do not edit `docs/15-judgement-calls.md` by hand. The next regeneration overwrites it, and the check fails if it has drifted.

## The register: docs/15-judgement-calls.md

`docs/15-judgement-calls.md` is the register of judgement calls. For each call it gives:

- what the call is, in plain words, and the options;
- why it was chosen;
- how it was evidenced (measured, from our documents, inferred, assumed, or fixed by the code);
- what the results would look like if the call were wrong;
- who holds a veto, and its review state.

Read it before you rely on any number in the study. At the time of writing it lists 24 judgement calls, and 22 are not yet reviewed by ACAPS. Vetoes and changes are made as described under "Changing an assumption" above.

## Tests

- `npm test` runs the fast tests.
- `npm run test:slow` runs the slower tests in `packages/simulate/test/slow/`. These include Monte Carlo checks with many replicates, and an end-to-end quick run that takes about a minute.
