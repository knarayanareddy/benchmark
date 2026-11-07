import { ANON_ORDER, type AnonLevel } from "./constants";

export type ExpertRow = {
  id: number;
  alias: string;
  realName: string;
  org: string;
  anonymity: string;
  retroactive: boolean;
  region?: string;
  verification: string;
  isModerator?: boolean;
};

export type Viewer =
  | { role: "public" }
  | { role: "peer"; id: number }
  | { role: "moderator"; id: number };

const rank = (l: string) => Math.max(0, ANON_ORDER.indexOf(l as AnonLevel));

/**
 * Effective level for ONE contribution.
 *  - "profile" mode follows the expert's current level (so a later retreat re-masks everything).
 *  - an explicit per-contribution mode can only make a contribution MORE private than the
 *    expert's current level when `retroactive` is on.
 */
export function effectiveLevel(e: ExpertRow, mode: string): AnonLevel {
  if (!mode || mode === "profile") return e.anonymity as AnonLevel;
  const a = rank(mode);
  const b = e.retroactive ? rank(e.anonymity) : 0;
  return ANON_ORDER[Math.max(a, b)];
}

export type Shown = {
  label: string;
  sub: string;
  level: AnonLevel;
  /** true if the viewer is looking at their own contribution */
  self: boolean;
  /** stable key for grouping, null when unlinkable */
  linkKey: string | null;
};

/**
 * THE single place where identity leaves the database.
 * Public never sees any individual. Everything else is an allowlist per level.
 */
export function showExpert(e: ExpertRow, mode: string, viewer: Viewer): Shown {
  const level = effectiveLevel(e, mode);
  const region = e.region ?? "";
  if (viewer.role === "public") {
    return { label: "Anonymous expert", sub: "", level, self: false, linkKey: null };
  }
  const self = viewer.id === e.id;
  const shownToOthers = ((): Omit<Shown, "self"> => {
    if (viewer.role === "moderator") {
      if (level === "named" || level === "confidential") {
        return { label: e.realName, sub: e.org, level, linkKey: `e${e.id}` };
      }
      if (level === "alias") {
        return { label: e.alias, sub: "Identity not disclosed to ACAPS", level, linkKey: `e${e.id}` };
      }
      return {
        label: "Sealed expert",
        sub: `${e.verification === "verified" ? "Verified" : "Invited"}${region ? " · " + region : ""}`,
        level,
        linkKey: null,
      };
    }
    // peer
    if (level === "named") return { label: e.realName, sub: e.org, level, linkKey: `e${e.id}` };
    if (level === "confidential" || level === "alias") {
      return { label: e.alias, sub: "Pseudonym", level, linkKey: `e${e.id}` };
    }
    return { label: "Anonymous expert", sub: region, level, linkKey: null };
  })();
  if (self) {
    return {
      ...shownToOthers,
      label: `You`,
      sub: `shown as: ${shownToOthers.label}${shownToOthers.sub ? " · " + shownToOthers.sub : ""}`,
      self: true,
    };
  }
  return { ...shownToOthers, self: false };
}

const ADJ = ["Amber", "Quiet", "Cobalt", "Saffron", "Willow", "Basalt", "Juniper", "Sable", "Coral", "Lunar", "Ember", "Ivory", "Slate", "Tidal", "Maple", "Onyx"];
const ANI = ["Heron", "Ibis", "Gazelle", "Lynx", "Kestrel", "Otter", "Falcon", "Oryx", "Marten", "Plover", "Egret", "Civet", "Hare", "Swift", "Kite", "Wren"];

export function makeAlias(n: number): string {
  return `${ADJ[n % ADJ.length]} ${ANI[Math.floor(n / ADJ.length + n * 7) % ANI.length]}`;
}
