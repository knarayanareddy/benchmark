/**
 * Shared shapes for the simulator. Types only, plus the one runtime constant every module agrees on.
 *
 * @typedef {{ id:string, risk:number, band:0|1|2|3|4, a:number, L:number, pi:number, y:0|1|null, kind:'risk'|'trigger' }} Card
 * @typedef {{ id:number, bias:number, skill:number, uninformed:boolean, herd:number }} Expert
 * @typedef {{ card:Card, ps:number[], experts:number[] }} Panel
 * @typedef {Record<string, number|string|boolean|null>} Params
 */

/** The two card kinds. Ids are `SIM-nnnnnn` for risk cards and `SIM-Tnnnnnn` for trigger cards. */
export const KINDS = Object.freeze(['risk', 'trigger']);
