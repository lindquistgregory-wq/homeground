/**
 * Safety notes for the design map (Safety & Liability Review, Oct 2026). Each note follows the
 * ANSI Z535 order (hazard, how to avoid it; then the consequence and the rule to check in
 * `details`) and is shown at the point of use, collapsed to one line once the person has read it.
 * Notes inform and point to the authority; they never instruct a hazardous step, and never call
 * anything "safe". Bump `version` when a note's meaning changes so it is shown open again.
 */

export type SafetyLevel = 'caution' | 'note';

export interface SafetySource {
  title: string;
  url: string;
}

export interface SafetyNote {
  id: string;
  /** caution: a hazard to people (the Z535 "CAUTION" sense); note: property, legal or permits. */
  level: SafetyLevel;
  /** One line: the hazard and how to avoid it. */
  headline: string;
  /** What can happen, and the rule or authority to check. */
  details: string[];
  sources: SafetySource[];
  /** Shown open until acknowledged once (the highest hazards). */
  acknowledge?: boolean;
  version: number;
}

const SRC = {
  phmsa: { title: 'PHMSA: Call before you dig', url: 'https://ia-training.phmsa.dot.gov/comm/CBYD.htm' },
  epaWells: { title: 'EPA: protect your home’s water', url: 'https://www.epa.gov/privatewells/protect-your-homes-water' },
  cdcRain: { title: 'CDC: collecting rainwater and your health', url: 'https://www.cdc.gov/drinking-water/about/collecting-rainwater-and-your-health-an-overview.html' },
  epa404: { title: 'EPA: Clean Water Act Section 404 permits', url: 'https://www.epa.gov/cwa-404/permit-program-under-cwa-section-404' },
  femaMaps: { title: 'FEMA Flood Map Service Center', url: 'https://msc.fema.gov/portal/home' },
  doeSolar: { title: 'U.S. DOE: homeowner’s guide to going solar', url: 'https://www.energy.gov/eere/solar/homeowners-guide-going-solar' },
  cdcPoultry: { title: 'CDC: backyard poultry and Salmonella', url: 'https://www.cdc.gov/salmonella/backyardpoultry-05-23/index.html' },
  coRain: { title: 'Colorado Division of Water Resources: rainwater', url: 'https://dwr.colorado.gov/services/water-administration/rainwater-storm-water-graywater' },
  caFence: { title: 'California SB 582 (electrified fence signs)', url: 'https://www.leginfo.ca.gov/pub/15-16/bill/sen/sb_0551-0600/sb_582_bill_20150827_enrolled.htm' },
} as const;

export const SAFETY_NOTES = {
  dig811: {
    id: 'dig811', level: 'caution', acknowledge: true, version: 1,
    headline: 'Call or click 811 a few working days before you dig.',
    details: [
      'Buried gas, power and water lines can cause serious injury if hit. State law requires the call for anyone digging, homeowners included, and fines can be large.',
      'The service is free: utilities mark their lines for you.',
    ],
    sources: [SRC.phmsa],
  },
  pond: {
    id: 'pond', level: 'caution', acknowledge: true, version: 1,
    headline: 'Water is a drowning risk: fence it or supervise children and animals.',
    details: [
      'Many local codes treat ponds like pools for fencing.',
      'Digging near a stream or wetland, or in a flood zone, can need federal, state or local permits.',
    ],
    sources: [SRC.epa404, SRC.femaMaps],
  },
  electricFence: {
    id: 'electricFence', level: 'caution', acknowledge: true, version: 1,
    headline: 'Electric fences can shock people: post signs where it meets a road, path or neighbour, and keep it away from play areas.',
    details: [
      'Use a listed energizer and follow its instructions. Some states and towns require warning signs at set intervals; check local rules.',
    ],
    sources: [SRC.caFence],
  },
  solar: {
    id: 'solar', level: 'caution', version: 1,
    headline: 'Have a licensed installer or electrician do the wiring; ground-mounted arrays usually need a permit.',
    details: ['Output figures here are estimates, not a quote or an engineering design.'],
    sources: [SRC.doeSolar],
  },
  storedWater: {
    id: 'storedWater', level: 'caution', version: 1,
    headline: 'Stored rainwater isn’t for drinking or cooking unless it’s treated and tested.',
    details: [
      'Use it for watering. Keep containers covered or screened against children, animals and mosquitoes.',
      'Your health department can advise on treatment and testing.',
    ],
    sources: [SRC.cdcRain],
  },
  well: {
    id: 'well', level: 'caution', version: 1,
    headline: 'Test a private well every year for bacteria, nitrate, pH and dissolved solids.',
    details: [
      'Test more often with infants, pregnancy or older adults in the home: high nitrate is dangerous for infants.',
      'Keep animals, manure and compost at least 200 ft away. Your state’s well code may set a different distance.',
    ],
    sources: [SRC.epaWells],
  },
  structure: {
    id: 'structure', level: 'note', version: 1,
    headline: 'Buildings and greenhouses may need a permit: check setbacks and snow and wind ratings.',
    details: ['Your county or town building department can tell you what applies.'],
    sources: [],
  },
  rootCellar: {
    id: 'rootCellar', level: 'caution', version: 1,
    headline: 'Excavations can collapse: get professional advice before building below ground.',
    details: ['Below-ground structures usually need a permit and an engineered design.'],
    sources: [],
  },
  drainage: {
    id: 'drainage', level: 'note', version: 1,
    headline: 'Don’t send water onto neighbouring land or a road: check local grading and stormwater rules.',
    details: [],
    sources: [],
  },
  woodStorage: {
    id: 'woodStorage', level: 'note', version: 1,
    headline: 'Stack firewood away from the house to limit fire risk and pests.',
    details: [],
    sources: [],
  },
  bees: {
    id: 'bees', level: 'caution', version: 1,
    headline: 'Stings can be dangerous for people with allergies: keep hives away from paths and neighbours, and check local rules.',
    details: ['Some towns require setbacks or a flyway barrier near property lines.'],
    sources: [],
  },
  poultry: {
    id: 'poultry', level: 'caution', version: 1,
    headline: 'Poultry can carry Salmonella: wash hands after handling, and keep children under 5 away.',
    details: [
      'CDC advice: wash with soap and water for 20 seconds; don’t kiss or snuggle birds; keep birds and their supplies out of the house.',
    ],
    sources: [SRC.cdcPoultry],
  },
  coloradoRain: {
    id: 'coloradoRain', level: 'note', version: 1,
    headline: 'Colorado allows at most two rain barrels (110 gallons in total), for outdoor use on the same property.',
    details: ['Rain barrel water can’t be used for drinking or indoors under Colorado law.'],
    sources: [SRC.coRain],
  },
} satisfies Record<string, SafetyNote>;

export type SafetyNoteId = keyof typeof SAFETY_NOTES;

/** Objects that involve digging (posts, trenches, planting holes, excavation). */
export const IN_GROUND_KINDS: ReadonlySet<string> = new Set([
  'in-ground-row', 'hugel', 'guild', 'berry-row', 'three-sisters',
  'fruit-tree-dwarf', 'fruit-tree-semi', 'fruit-tree-std', 'nut-tree', 'evergreen-tree', 'windbreak',
  'hoop-tunnel', 'high-tunnel', 'greenhouse-hoop', 'greenhouse-gable', 'greenhouse-dome', 'greenhouse-leanto',
  'potting-shed', 'tool-shed', 'barn', 'root-cellar', 'chicken-run', 'paddock', 'goat-shelter',
  'pond', 'swale', 'cistern', 'well',
  'solar-array', 'fence-deer', 'fence-garden', 'fence-electric', 'gate', 'trellis', 'arch',
]);

const STRUCTURES = new Set(['greenhouse-leanto', 'greenhouse-hoop', 'greenhouse-gable', 'greenhouse-dome', 'high-tunnel', 'potting-shed', 'tool-shed', 'barn', 'chicken-coop', 'duck-house', 'goat-shelter']);

const BY_KIND: Record<string, SafetyNoteId[]> = {
  pond: ['pond', 'drainage'],
  swale: ['drainage'],
  'fence-electric': ['electricFence'],
  'solar-array': ['solar'],
  'rain-barrel': ['storedWater'],
  'ibc-tote': ['storedWater'],
  cistern: ['storedWater'],
  well: ['well'],
  'root-cellar': ['rootCellar'],
  'wood-storage': ['woodStorage'],
  beehive: ['bees'],
  'chicken-coop': ['poultry'],
  'chicken-run': ['poultry'],
  'duck-house': ['poultry'],
};

export interface SafetyContext {
  /** Two-digit state FIPS of the parcel, for state-specific notes. */
  stateFips?: string;
}

/** Notes for one kind of object, most serious first, without duplicates. */
export function safetyNotesFor(kind: string, ctx: SafetyContext = {}): SafetyNote[] {
  const ids: SafetyNoteId[] = [...(BY_KIND[kind] ?? [])];
  if (IN_GROUND_KINDS.has(kind)) ids.unshift('dig811');
  if (STRUCTURES.has(kind)) ids.push('structure');
  if (ctx.stateFips === '08' && (kind === 'rain-barrel' || kind === 'ibc-tote' || kind === 'cistern')) ids.push('coloradoRain');
  const notes = [...new Set(ids)].map((id) => SAFETY_NOTES[id] as SafetyNote);
  return notes.sort((a, b) => (a.level === b.level ? Number(!!b.acknowledge) - Number(!!a.acknowledge) : a.level === 'caution' ? -1 : 1));
}

/** Acknowledgement key: changes when the note's text changes, so it reopens. */
export const ackKey = (n: SafetyNote) => `${n.id}@${n.version}`;
