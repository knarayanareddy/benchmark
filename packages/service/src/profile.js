/**
 * The expert's own profile: who they are for matching (organisation, role) and what they are asked
 * (weekly cap). It lives on the roster expert document next to the declaration. Nobody
 * but the owner reads it; no audit row names it (docs/10-pilot-experience.md, section 1).
 */
import { coarsenToDay } from '@benchmark/core/anonymity';
import { THEMES, ROLE_TYPES } from '@benchmark/core/taxonomy';
import { ValidationError, ConflictError } from './errors.js';

const DEFAULT_WEEKLY_CAP = 3;
const ORGANISATION_MAX = 120;
const ISO3 = /^[A-Z]{3}$/;

/** @param {unknown} v @param {number} lo @param {number} hi */
const inRange = (v, lo, hi) => Number.isInteger(v) && /** @type {number} */ (v) >= lo && /** @type {number} */ (v) <= hi;

/**
 * Every problem at once, so one save attempt tells the person everything to fix. Returns the
 * cleaned values; throws before anything is written.
 * @param {Record<string, any>} input
 * @param {Record<string, any>} current the stored profile, for fields the caller left out
 */
function checkProfile(input, current) {
  /** @type {string[]} */
  const problems = [];

  /** @type {string | null} */
  let organisation = null;
  if (input.organisation !== undefined && input.organisation !== null) {
    if (typeof input.organisation !== 'string') problems.push('organisation must be text');
    else {
      const o = input.organisation.trim();
      if ([...o].length > ORGANISATION_MAX) problems.push(`organisation must be ${ORGANISATION_MAX} characters or fewer`);
      else if (o !== '') organisation = o;
    }
  }

  /** @type {string | null} */
  let roleType = null;
  if (input.roleType !== undefined && input.roleType !== null && input.roleType !== '') {
    if (typeof input.roleType !== 'string' || !Object.hasOwn(ROLE_TYPES, input.roleType.trim())) {
      problems.push(`roleType must be one of ${Object.keys(ROLE_TYPES).join(', ')}`);
    } else roleType = input.roleType.trim();
  }

  const countries = [];
  if (!Array.isArray(input.countries)) problems.push('countries must be a list of ISO 3-letter codes (like TCD)');
  else {
    for (const c of input.countries) {
      const code = typeof c === 'string' ? c.trim().toUpperCase() : '';
      if (!ISO3.test(code)) problems.push(`countries must be ISO 3-letter codes (like TCD); got ${JSON.stringify(c)}`);
      else if (!countries.includes(code)) countries.push(code);
    }
    if (countries.length === 0) problems.push('a Declaration needs at least one country');
  }

  /** @param {unknown} list @param {string} label @param {(v: string) => boolean} known */
  const vocabList = (list, label, known) => {
    if (list === undefined || list === null) return [];
    if (!Array.isArray(list)) { problems.push(`${label} must be a list`); return []; }
    const out = [];
    for (const v of list) {
      const s = typeof v === 'string' ? v.trim() : '';
      if (s === '') continue;
      if (!known(s)) problems.push(`${label} has an unknown entry: ${JSON.stringify(v)}`);
      else if (!out.includes(s)) out.push(s);
    }
    return out;
  };
  const themes = vocabList(input.themes, 'themes', (s) => Object.hasOwn(THEMES, s));

  const weeklyCap = input.weeklyCap === undefined ? (current.weeklyCap ?? DEFAULT_WEEKLY_CAP) : input.weeklyCap;
  if (!inRange(weeklyCap, 1, 7)) problems.push('weeklyCap must be a whole number from 1 to 7');

  if (problems.length) throw new ValidationError(`profile cannot be saved: ${problems.join('; ')}`, { problems });
  return { organisation, roleType, countries, themes, weeklyCap };
}

/** @param {Record<string, any>} e the roster expert document */
function viewOf(e) {
  const p = e.profile ?? {};
  return {
    name: e.name ?? null,
    level: e.level ?? null,
    mode: e.tokenMode === 'device' ? 'device' : 'server',
    organisation: p.organisation ?? null,
    roleType: p.roleType ?? null,
    declaration: {
      countries: [...(e.declaration?.countries ?? [])],
      regions: [...(e.declaration?.regions ?? [])],
      themes: [...(e.declaration?.themes ?? [])],
    },
    weeklyCap: p.weeklyCap ?? DEFAULT_WEEKLY_CAP,
    needsSetup: !p.completedAt,
    vocab: { themes: { ...THEMES }, roleTypes: { ...ROLE_TYPES } },
  };
}

/** @param {any} ctx */
export function createProfile(ctx) {
  const { roster, need, expertOf, t } = ctx;

  /** @param {any} actor */
  async function getProfile(actor) {
    need(actor, 'me.manage');
    return viewOf(await expertOf(actor));
  }

  /**
   * Replaces the declaration's countries and themes and the profile together. The declaration's regions
   * are staff's to set and are carried over exactly as stored. Fields left out keep their stored value
   * (or the default). Unknown input keys are ignored. The anonymity level, token mode, consent and name
   * are never touched.
   * @param {any} actor @param {Record<string, any>} [input]
   */
  async function setProfile(actor, input = {}) {
    need(actor, 'me.manage');
    const e = await expertOf(actor);
    const clean = checkProfile(input ?? {}, e.profile ?? {});
    // Re-read so the write is built from the row as it is now, and a compare-and-set on its version: a write
    // can never recreate an account erased since the read. The check is still not atomic with the caller's
    // other reads, so a concurrent edit of the declaration can be overwritten by this save.
    const cur = await roster.experts.get(e.id);
    if (!cur) throw new ConflictError('account no longer exists');
    const next = {
      ...cur,
      declaration: { countries: clean.countries, regions: [...(cur.declaration?.regions ?? [])], themes: clean.themes },
      profile: {
        organisation: clean.organisation,
        roleType: clean.roleType,
        weeklyCap: clean.weeklyCap,
        completedAt: cur.profile?.completedAt ?? coarsenToDay(t()).ms,
      },
    };
    const version = cur.version ?? 0;
    try {
      await roster.experts.update(e.id, version, { ...next, version: version + 1 });
    } catch (err) {
      if (!(err instanceof ConflictError)) throw err;
      if (!(await roster.experts.get(e.id))) throw new ConflictError('account no longer exists');
      throw new ConflictError('your profile changed while you were saving: reload and try again');
    }
    return viewOf(next);
  }

  return { getProfile, setProfile };
}
