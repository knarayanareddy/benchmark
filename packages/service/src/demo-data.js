/**
 * Hand-written demo content for `seedDemo()` (docs/10-pilot-experience.md, sections 1, 2 and 4). Plain data only.
 * Everything here is synthetic: the panel is made up, the estimates are chosen by hand to show a spread,
 * and each card's objective starts with "DEMO:". Statements are forecasts about the future, not claims
 * about events that already happened. Nothing here is a result.
 *
 * Coverage: the open Round-1 cards cover the radar's most frequent countries (data/risk-radar.json, counted
 * per ISO code), so a visitor from almost any of them sees a Pulse. Eligibility is `matches()` from
 * core/dispatch.js, strict on countries and themes; a declaration with no themes matches every theme.
 *
 * `probability` is one of a small hand-picked list (Low, Medium, High). It is NOT derived from any analysis
 * and it is not a real ACAPS rating.
 */

/** The synthetic panel. `by` in cards refers to the index here. Declarations have countries and themes only. */
export const DEMO_PANEL = Object.freeze([
  { name: 'Demo Amara', level: 'identified', organisation: 'Demo: coastal NGO', roleType: 'local_ngo', countries: ['KEN', 'IDN', 'SOM'], themes: ['climate', 'food'] },
  { name: 'Demo Lucas', level: 'identified', organisation: 'Demo: research unit', roleType: 'conflict_analyst', countries: ['MOZ', 'ZWE'], themes: ['conflict'] },
  { name: null, level: 'pseudonymous', organisation: null, roleType: 'researcher', countries: ['BGD'], themes: ['displacement'] },
  { name: null, level: 'pseudonymous', organisation: null, roleType: 'un_ingo', countries: ['COL', 'MEX'], themes: ['health', 'political_economic'] },
  { name: null, level: 'anonymous', organisation: null, roleType: 'aa_practitioner', countries: ['IDN', 'MNG', 'COL'], themes: ['climate', 'health'] },
  { name: null, level: 'anonymous', organisation: null, roleType: 'local_ngo', countries: ['SOM', 'ETH', 'BGD'], themes: ['food', 'displacement'] },
  { name: 'Demo Chen', level: 'identified', organisation: 'Demo: health network', roleType: 'other', countries: ['KEN', 'MEX'], themes: ['climate', 'health', 'political_economic'] },
  { name: null, level: 'pseudonymous', organisation: null, roleType: 'conflict_analyst', countries: ['TCD', 'MLI', 'MOZ'], themes: ['conflict', 'displacement'] },
]);

/**
 * state: 'open' (Round 1 open), 'closed' (Round 1 closed, with a thread), 'round2' (Round 2 open, released aggregate).
 * country (ISO3), theme (a key of THEMES), region (a value of REGIONS).
 * estimates: [panel index, p] pairs for Round 1 (open cards get 0 to 3; special cards get enough to release).
 * thread: posts by panel index; `approve: false` leaves the post pending for a moderator.
 * windowDays: offsets in days from the seed date, for the resolution window.
 * The radar risk linked is the first one (by id) for `country`.
 */
export const DEMO_CARDS = Object.freeze([
  {
    key: 'kenya-drought', state: 'open', country: 'KEN', region: 'East & Southern Africa', theme: 'climate', windowDays: { from: 0, to: 120 },
    statement: 'Kenya\'s government formally declares a national drought emergency within the window.',
    objective: 'DEMO: a gazette notice or official statement declaring a national drought emergency is published in the window',
    resolutionSource: 'official_decree', resolver: 'Demo resolver', probability: 'Medium',
    estimates: [],
  },
  {
    key: 'sudan-conflict', state: 'open', country: 'SDN', region: 'East & Southern Africa', theme: 'conflict', windowDays: { from: 0, to: 120 },
    statement: 'ACLED records at least 200 violent events in Sudan within the window.',
    objective: 'DEMO: the ACLED event count for Sudan reaches 200 or more between the window dates',
    resolutionSource: 'ACLED', resolver: 'Demo resolver', probability: 'High',
    estimates: [[0, 0.8]],
  },
  {
    key: 'sudan-food', state: 'open', country: 'SDN', region: 'East & Southern Africa', theme: 'food', windowDays: { from: 0, to: 150 },
    statement: 'An IPC analysis for Sudan classifies at least 15 million people in Phase 3 or worse within the window.',
    objective: 'DEMO: an IPC analysis published in the window classifies at least 15 million people in Phase 3 or worse',
    resolutionSource: 'IPC', resolver: 'Demo resolver', probability: 'High',
    estimates: [],
  },
  {
    key: 'syria-displacement', state: 'open', country: 'SYR', region: 'Middle East & North Africa', theme: 'displacement', windowDays: { from: 0, to: 150 },
    statement: 'UNHCR records more than 100,000 refugee returns to Syria within the window.',
    objective: 'DEMO: UNHCR return figures for Syria above 100,000 people between the window dates',
    resolutionSource: 'UNHCR', resolver: 'Demo resolver', probability: 'Low',
    estimates: [[6, 0.35], [7, 0.5], [2, 0.4]],
  },
  {
    key: 'drc-health', state: 'open', country: 'COD', region: 'Sahel & West/Central Africa', theme: 'health', windowDays: { from: 0, to: 120 },
    statement: 'The health ministry of the Democratic Republic of the Congo declares a new Ebola outbreak within the window.',
    objective: 'DEMO: an official declaration of a new Ebola outbreak in the Democratic Republic of the Congo is published in the window',
    resolutionSource: 'official_decree', resolver: 'Demo resolver', probability: 'Low',
    estimates: [[4, 0.2], [1, 0.3]],
  },
  {
    key: 'lebanon-imf', state: 'open', country: 'LBN', region: 'Middle East & North Africa', theme: 'political_economic', windowDays: { from: 0, to: 150 },
    statement: 'The IMF announces a staff-level agreement with Lebanon within the window.',
    objective: 'DEMO: an IMF press release announcing a staff-level agreement with Lebanon is published in the window',
    resolutionSource: 'IMF', resolver: 'Demo resolver', probability: 'Medium',
    estimates: [],
  },
  {
    key: 'mali-conflict', state: 'open', country: 'MLI', region: 'Sahel & West/Central Africa', theme: 'conflict', windowDays: { from: 0, to: 120 },
    statement: 'ACLED records at least 150 violent events in Mali within the window.',
    objective: 'DEMO: the ACLED event count for Mali reaches 150 or more between the window dates',
    resolutionSource: 'ACLED', resolver: 'Demo resolver', probability: 'High',
    estimates: [[7, 0.65]],
  },
  {
    key: 'afghanistan-returns', state: 'open', country: 'AFG', region: 'South & Central Asia', theme: 'displacement', windowDays: { from: 0, to: 150 },
    statement: 'UNHCR records more than 50,000 Afghan returnee arrivals from Iran and Pakistan within the window.',
    objective: 'DEMO: UNHCR arrival figures for Afghan returnees above 50,000 people between the window dates',
    resolutionSource: 'UNHCR', resolver: 'Demo resolver', probability: 'Medium',
    estimates: [[0, 0.45], [3, 0.5], [5, 0.3]],
  },
  {
    key: 'niger-food', state: 'open', country: 'NER', region: 'Sahel & West/Central Africa', theme: 'food', windowDays: { from: 0, to: 120 },
    statement: 'The IPC analysis for Niger classifies more than 1 million people in Phase 3 or worse within the window.',
    objective: 'DEMO: an IPC analysis published in the window classifies more than 1 million people in Phase 3 or worse',
    resolutionSource: 'IPC', resolver: 'Demo resolver', probability: 'Medium',
    estimates: [[6, 0.7], [2, 0.6]],
  },
  {
    key: 'colombia-displacement', state: 'open', country: 'COL', region: 'Americas & Europe', theme: 'displacement', windowDays: { from: 0, to: 150 },
    statement: 'UNHCR records more than 50,000 new Venezuelan arrivals in Colombia within the window.',
    objective: 'DEMO: UNHCR arrival figures for Venezuelans arriving in Colombia above 50,000 between the window dates',
    resolutionSource: 'UNHCR', resolver: 'Demo resolver', probability: 'Low',
    estimates: [],
  },
  {
    key: 'libya-conflict', state: 'open', country: 'LBY', region: 'Middle East & North Africa', theme: 'conflict', windowDays: { from: 0, to: 120 },
    statement: 'ACLED records at least 50 violent events in Tripoli within the window.',
    objective: 'DEMO: the ACLED event count for Tripoli reaches 50 or more between the window dates',
    resolutionSource: 'ACLED', resolver: 'Demo resolver', probability: 'Medium',
    estimates: [[4, 0.55]],
  },
  {
    key: 'myanmar-conflict', state: 'open', country: 'MMR', region: 'South-East Asia & Pacific', theme: 'conflict', windowDays: { from: 0, to: 150 },
    statement: 'ACLED records at least 300 violent events in Myanmar in one calendar month within the window.',
    objective: 'DEMO: an ACLED calendar month in the window records 300 or more violent events in Myanmar',
    resolutionSource: 'ACLED', resolver: 'Demo resolver', probability: 'High',
    estimates: [[1, 0.25], [5, 0.35], [7, 0.4]],
  },
  {
    key: 'palestine-food', state: 'open', country: 'PSE', region: 'Middle East & North Africa', theme: 'food', windowDays: { from: 0, to: 120 },
    statement: 'The IPC analysis for the Palestinian territories classifies at least 500,000 people in Phase 3 or worse within the window.',
    objective: 'DEMO: an IPC analysis published in the window classifies at least 500,000 people in Phase 3 or worse',
    resolutionSource: 'IPC', resolver: 'Demo resolver', probability: 'Medium',
    estimates: [[3, 0.5], [0, 0.6]],
  },
  {
    key: 'philippines-climate', state: 'open', country: 'PHL', region: 'South-East Asia & Pacific', theme: 'climate', windowDays: { from: 0, to: 120 },
    statement: 'The Philippine government declares a state of calamity in at least one province within the window.',
    objective: 'DEMO: an official declaration of a state of calamity in a Philippine province is published in the window',
    resolutionSource: 'official_decree', resolver: 'Demo resolver', probability: 'Medium',
    estimates: [],
  },
  {
    key: 'yemen-food', state: 'open', country: 'YEM', region: 'Middle East & North Africa', theme: 'food', windowDays: { from: 0, to: 150 },
    statement: 'The IPC analysis for Yemen classifies at least 15 million people in Phase 3 or worse within the window.',
    objective: 'DEMO: an IPC analysis published in the window classifies at least 15 million people in Phase 3 or worse',
    resolutionSource: 'IPC', resolver: 'Demo resolver', probability: 'High',
    estimates: [[2, 0.75]],
  },
  {
    key: 'chad-displacement', state: 'open', country: 'TCD', region: 'Sahel & West/Central Africa', theme: 'displacement', windowDays: { from: 0, to: 120 },
    statement: 'UNHCR records more than 30,000 new refugee arrivals in Chad from Sudan within the window.',
    objective: 'DEMO: UNHCR arrival figures for refugees arriving in Chad from Sudan above 30,000 between the window dates',
    resolutionSource: 'UNHCR', resolver: 'Demo resolver', probability: 'High',
    estimates: [[1, 0.3], [4, 0.45], [6, 0.55]],
  },
  {
    key: 'nigeria-conflict', state: 'open', country: 'NGA', region: 'Sahel & West/Central Africa', theme: 'conflict', windowDays: { from: 0, to: 180 },
    statement: 'ACLED records at least 200 violent events in Borno state within the window.',
    objective: 'DEMO: the ACLED event count for Borno state reaches 200 or more between the window dates',
    resolutionSource: 'ACLED', resolver: 'Demo resolver', probability: 'High',
    estimates: [[0, 0.65], [3, 0.7]],
  },
  {
    key: 'haiti-conflict', state: 'open', country: 'HTI', region: 'Americas & Europe', theme: 'conflict', windowDays: { from: 0, to: 120 },
    statement: 'ACLED records at least 150 violent events in Haiti within the window.',
    objective: 'DEMO: the ACLED event count for Haiti reaches 150 or more between the window dates',
    resolutionSource: 'ACLED', resolver: 'Demo resolver', probability: 'High',
    estimates: [],
  },
  {
    key: 'south-sudan-food', state: 'open', country: 'SSD', region: 'East & Southern Africa', theme: 'food', windowDays: { from: 0, to: 150 },
    statement: 'The IPC analysis for South Sudan classifies more than 6 million people in Phase 3 or worse within the window.',
    objective: 'DEMO: an IPC analysis published in the window classifies more than 6 million people in Phase 3 or worse',
    resolutionSource: 'IPC', resolver: 'Demo resolver', probability: 'High',
    estimates: [[5, 0.4]],
  },
  {
    key: 'uganda-displacement', state: 'open', country: 'UGA', region: 'East & Southern Africa', theme: 'displacement', windowDays: { from: 0, to: 120 },
    statement: 'UNHCR records more than 40,000 new refugee arrivals in Uganda from South Sudan within the window.',
    objective: 'DEMO: UNHCR arrival figures for refugees arriving in Uganda from South Sudan above 40,000 between the window dates',
    resolutionSource: 'UNHCR', resolver: 'Demo resolver', probability: 'Medium',
    estimates: [[2, 0.5], [4, 0.55], [7, 0.6]],
  },
  {
    key: 'ukraine-conflict', state: 'open', country: 'UKR', region: 'Americas & Europe', theme: 'conflict', windowDays: { from: 0, to: 120 },
    statement: 'ACLED records at least 500 violent events in Ukraine within the window.',
    objective: 'DEMO: the ACLED event count for Ukraine reaches 500 or more between the window dates',
    resolutionSource: 'ACLED', resolver: 'Demo resolver', probability: 'High',
    estimates: [[6, 0.8], [1, 0.75]],
  },
  {
    key: 'bangladesh-arrivals', state: 'open', country: 'BGD', region: 'South & Central Asia', theme: 'displacement', windowDays: { from: 0, to: 150 },
    statement: 'UNHCR records more than 20,000 new Rohingya arrivals in Bangladesh within the window.',
    objective: 'DEMO: UNHCR arrivals data for Bangladesh above 20,000 people between the window dates',
    resolutionSource: 'UNHCR', resolver: 'Demo resolver', probability: 'Low',
    estimates: [[2, 0.25]],
  },
  {
    key: 'mozambique-violence', state: 'open', country: 'MOZ', region: 'East & Southern Africa', theme: 'conflict', windowDays: { from: 0, to: 180 },
    statement: 'ACLED records at least 100 violent events in Cabo Delgado province within the window.',
    objective: 'DEMO: the ACLED event count for Cabo Delgado reaches 100 or more between the window dates',
    resolutionSource: 'ACLED', resolver: 'Demo resolver', probability: 'High',
    estimates: [[1, 0.7], [5, 0.6]],
  },
  {
    key: 'mexico-inflation', state: 'open', country: 'MEX', region: 'Americas & Europe', theme: 'political_economic', windowDays: { from: 0, to: 90 },
    statement: 'IMF data show Mexico\'s annual headline inflation at 5.0 or higher in at least one month of the window.',
    objective: 'DEMO: an IMF monthly value of 5.0 or higher for Mexico within the window dates',
    resolutionSource: 'IMF', resolver: 'Demo resolver', probability: 'Low',
    estimates: [[3, 0.3], [4, 0.45], [7, 0.4]],
  },
  {
    key: 'somalia-ipc', state: 'open', country: 'SOM', region: 'East & Southern Africa', theme: 'food', windowDays: { from: 0, to: 120 },
    statement: 'The IPC analysis for Somalia classifies more than 2 million people in Phase 4 or worse within the window.',
    objective: 'DEMO: an IPC analysis published in the window classifies more than 2 million people in Phase 4 or worse',
    resolutionSource: 'IPC', resolver: 'Demo resolver', probability: 'High',
    estimates: [[5, 0.6], [6, 0.55]],
  },
  {
    key: 'colombia-measles', state: 'closed', country: 'COL', region: 'Americas & Europe', theme: 'health', windowDays: { from: 0, to: 120 },
    statement: 'Colombia\'s health ministry declares a national measles emergency within the window.',
    objective: 'DEMO: an official decree or ministry resolution declaring a national measles emergency is published in the window',
    resolutionSource: 'official_decree', resolver: 'Demo resolver', probability: 'Medium',
    estimates: [[0, 0.35], [1, 0.2], [2, 0.4], [3, 0.3], [4, 0.25]],
    thread: [
      { by: 0, kind: 'claim', text: 'Vaccination coverage fell in several departments last year, so the ministry has a reason to act.', approve: true },
      { by: 1, kind: 'question', text: 'Would a regional emergency decree count, or does the question need a national one?', approve: true },
      { by: 2, kind: 'evidence', text: 'The national vaccination dashboard is updated every week, so the window should show a clear trend.', approve: true },
      { by: 3, kind: 'counter', text: 'Ministries often prefer campaigns to emergency declarations, so I expect the declaration to be held back.', approve: false },
    ],
  },
  {
    key: 'indonesia-flood', state: 'round2', country: 'IDN', region: 'South-East Asia & Pacific', theme: 'climate', windowDays: { from: 0, to: 150 },
    statement: 'Indonesia\'s national disaster agency declares a provincial emergency for flooding in at least one province within the window.',
    objective: 'DEMO: an agency declaration of a provincial flood emergency is published in the window',
    resolutionSource: 'official_decree', resolver: 'Demo resolver', probability: 'High',
    estimates: [[0, 0.55], [1, 0.65], [2, 0.4], [3, 0.8], [4, 0.5], [5, 0.7]],
    secondLook: {
      acapsReasoning: 'Analysts weigh the seasonal rainfall outlook and how many provinces are already on flood watch, which have been a fair guide to past provincial emergency declarations.',
      sources: [{ label: 'Demo background: ReliefWeb disaster updates', url: 'https://reliefweb.int/' }],
      higher: ['Seasonal rainfall outlooks point to heavier than usual rain in several islands.', 'More provinces have been placed on flood watch this season than last.'],
      lower: ['Past provincial declarations were often limited to a single district rather than a whole province.', 'Local governments can respond without a provincial declaration, which lowers the chance of one being issued.'],
    },
  },
  {
    key: 'indonesia-quake', state: 'open', country: 'IDN', region: 'South-East Asia & Pacific', theme: 'climate', windowDays: { from: 0, to: 120 },
    statement: 'Indonesia\'s government declares a national disaster emergency for an earthquake within the window.',
    objective: 'DEMO: an official declaration of a national disaster emergency for an earthquake in Indonesia is published in the window',
    resolutionSource: 'official_decree', resolver: 'Demo resolver', probability: 'Low',
    estimates: [[3, 0.6]],
  },
]);
