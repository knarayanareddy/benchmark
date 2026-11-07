/**
 * Demo mode (docs/10-pilot-experience.md, section 2). Only created when `createService({ demo: true })`.
 * Everything goes through the public service methods, so every normal rule applies to demo accounts
 * and demo cards. The only things this module marks are the `demo` flags, and they are what keeps demo
 * data out of the analysis (`secondLookSummary`) and labelled on every screen.
 */
import { loadRadar } from '@benchmark/core/radar';
import { ROLES } from './auth.js';
import { CONSENT_VERSION } from './consent.js';
import { ValidationError, ConflictError } from './errors.js';
import { DEMO_PANEL, DEMO_CARDS } from './demo-data.js';

const JOIN_CAP = 300;
const NAME_MAX = 80;
const LEVELS_OK = ['identified', 'pseudonymous', 'anonymous'];
const MODES_OK = ['server', 'device'];
const JOIN_ACTOR = Object.freeze({ id: 'demo-system', role: ROLES.MODERATOR, kind: 'staff' });
const SEED_ACTOR = Object.freeze({ id: 'demo-seed', role: ROLES.MODERATOR, kind: 'staff' });

/** @param {number} ms */
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/** The profile fields the person may set (docs/10-pilot-experience.md, section 1). Anything else is dropped. */
const PROFILE_KEYS = ['organisation', 'roleType', 'countries', 'themes', 'weeklyCap'];
/** @param {any} profile */
const profileFields = (profile) => Object.fromEntries(PROFILE_KEYS.filter((k) => profile?.[k] !== undefined).map((k) => [k, profile[k]]));
/** @param {any} profile */
const declarationOf = (profile) => ({ countries: profile?.countries, themes: profile?.themes });

/**
 * @param {any} ctx the shared context built by service.js
 */
export function createDemo(ctx) {
  const { roster, answers, t, radarRaw, updateCard, demoLabels } = ctx;

  /** @returns {Promise<number>} */
  const countJoins = async () => (await roster.experts.find({ demoJoined: true })).length;

  /**
   * A real account from what the person typed. If anything fails after the account exists, it is
   * erased again, so a refused join leaves nothing behind.
   * @param {{ name?: unknown, level?: unknown, mode?: unknown, consentVersion?: unknown, profile?: any }} [input]
   */
  async function demoJoin(input = {}) {
    const { name, level, mode = 'server', consentVersion, profile } = input ?? {};
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (cleanName === '' || [...cleanName].length > NAME_MAX) throw new ValidationError(`name must be 1 to ${NAME_MAX} characters`);
    if (!LEVELS_OK.includes(/** @type {string} */ (level))) throw new ValidationError('choose an anonymity level: identified, pseudonymous or anonymous');
    if (!MODES_OK.includes(/** @type {string} */ (mode))) throw new ValidationError('mode must be server or device');
    if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) throw new ValidationError('profile must be an object');
    if (await countJoins() >= JOIN_CAP) throw new ConflictError(`the demo is full: it allows ${JOIN_CAP} accounts`);

    const svc = ctx.self();
    /** @type {string | null} */
    let expertId = null;
    try {
      // An anonymous account must not leave the typed name in the roster: its consent says ACAPS cannot see who it is.
      const inv = await svc.createInvite(JOIN_ACTOR, { name: level === 'anonymous' ? undefined : cleanName, declaration: declarationOf(profile) });
      expertId = inv.expertId;
      const r = await svc.redeemInvite(inv.token, { level, consentVersion, mode });
      const e = await roster.experts.get(expertId);
      await roster.experts.put(expertId, { ...e, demoJoined: true });
      const actor = await svc.authenticate(r.sessionToken);
      await svc.setProfile(actor, profileFields(profile));
      return { sessionToken: r.sessionToken, expertId, level: r.level, mode: r.mode };
    } catch (err) {
      if (expertId) await svc.eraseMe({ kind: 'expert', role: ROLES.EXPERT, expertId, id: expertId });
      throw err;
    }
  }

  /**
   * The first radar risk (by id) for a country, so a card links to the same risk on every seed.
   * @param {string} iso
   * @returns {string | null}
   */
  const riskFor = (iso) => loadRadar(radarRaw).risks.find((r) => r.isos.includes(iso))?.id ?? null;

  /**
   * Writes the synthetic panel and the demo cards. A no-op once any demo card exists, so a second run
   * cannot double the panel. A run that fails part-way is not resumed; see the report.
   */
  async function seedDemo() {
    const svc = ctx.self();
    if ((await answers.cards.find({ demo: true })).length > 0) return { seeded: false, experts: 0, cards: 0 };

    /** @type {Array<{ actor: any }>} */
    const panel = [];
    for (const p of DEMO_PANEL) {
      const inv = await svc.createInvite(SEED_ACTOR, { name: p.name ?? undefined, declaration: declarationOf(p) });
      const r = await svc.redeemInvite(inv.token, { level: p.level, consentVersion: CONSENT_VERSION });
      const actor = await svc.authenticate(r.sessionToken);
      await svc.setProfile(actor, profileFields(p));
      const e = await roster.experts.get(inv.expertId);
      await roster.experts.put(inv.expertId, { ...e, demo: true });
      panel.push({ actor });
    }

    const today = t();
    for (const c of DEMO_CARDS) {
      const { card: created } = await svc.createCard(SEED_ACTOR, {
        statement: c.statement, country: c.country, region: c.region, theme: c.theme,
        window: { from: dayOf(today + c.windowDays.from * 86400000), to: dayOf(today + c.windowDays.to * 86400000) },
        // Presenter mode (demoLabels off) drops the label from the objective only; the statement is unchanged.
        objective: demoLabels ? c.objective : c.objective.replace(/^DEMO: /, ''), resolutionSource: c.resolutionSource, resolver: c.resolver, probability: c.probability,
        riskId: riskFor(c.country) ?? undefined,
      });
      const card = await updateCard(created, { demo: true });
      if (c.thread) await svc.setThread(SEED_ACTOR, { cardId: card.id, enabled: true });
      if (c.secondLook) await svc.setSecondLook(SEED_ACTOR, { cardId: card.id, content: c.secondLook });
      for (const [by, p] of c.estimates) await svc.submitEstimate(panel[by].actor, { cardId: card.id, p });
      if (c.state === 'closed' || c.state === 'round2') await svc.closeRound(SEED_ACTOR, card.id);
      if (c.thread) {
        for (const post of c.thread) {
          const { id } = await svc.postToThread(panel[post.by].actor, { cardId: card.id, kind: post.kind, text: post.text });
          if (post.approve) await svc.moderate(SEED_ACTOR, id, { approve: true });
        }
      }
      if (c.state === 'round2') await svc.openRound2(SEED_ACTOR, card.id);
    }
    return { seeded: true, experts: DEMO_PANEL.length, cards: DEMO_CARDS.length };
  }

  return { demoJoin, seedDemo };
}
