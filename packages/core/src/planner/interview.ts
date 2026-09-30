/**
 * Discovery interview (§9.2): the same questions for every device. On-device models ask them in their
 * own words; devices without a model show them as short forms. At most three questions at a time, most
 * important first, and income questions only if the user wants income.
 */
import type { FoodAmbition, HomesteadGoals } from './goals';
import { FOOD_TARGETS } from './goals';

export type QuestionKind = 'household' | 'number' | 'choice' | 'multi' | 'boolean';

export interface Option<V = string> {
  value: V;
  label: string;
}

export interface Question {
  id: string;
  /** Short text the form shows (and a model can rephrase). */
  ask: string;
  help?: string;
  kind: QuestionKind;
  options?: Option[];
  unit?: string;
  /** Answered already? */
  answered(g: HomesteadGoals): boolean;
  /** Only ask when this holds (e.g. market access only if they want income). */
  relevant?(g: HomesteadGoals): boolean;
  /** Turn a form answer into a goals patch. */
  apply(answer: unknown): Partial<HomesteadGoals>;
}

const num = (v: unknown) => {
  if (v === undefined || v === null) return undefined;
  const s = typeof v === 'number' ? String(v) : String(v).replace(/[$,\s]/g, '');
  if (s === '') return undefined; // a cleared field is a skipped question, not 0
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

export const QUESTIONS: Question[] = [
  {
    id: 'household', ask: 'Who lives in your household?', help: 'Ages and roughly how active each person is. This sets how much food you need.', kind: 'household',
    answered: (g) => !!g.household?.length,
    apply: (a) => ({ household: a as HomesteadGoals['household'] }),
  },
  {
    id: 'goals', ask: 'What matters most to you?', kind: 'multi',
    options: [
      { value: 'food', label: 'Growing our own food' }, { value: 'savings', label: 'Saving money' }, { value: 'income', label: 'Earning some income' },
      { value: 'lifestyle', label: 'A way of life / time outdoors' }, { value: 'ecology', label: 'Wildlife, soil and ecology' }, { value: 'resilience', label: 'Resilience and self-reliance' },
    ],
    answered: (g) => !!g.goals?.length,
    apply: (a) => {
      const goals = a as HomesteadGoals['goals'];
      return { goals, ...(goals?.includes('income') ? { wantsIncome: true } : {}) };
    },
  },
  {
    id: 'ambition', ask: 'How much of your food would you like to grow?', kind: 'choice',
    options: (Object.keys(FOOD_TARGETS) as FoodAmbition[]).map((k) => ({ value: k, label: FOOD_TARGETS[k].label })),
    answered: (g) => !!g.ambition,
    apply: (a) => ({ ambition: a as FoodAmbition }),
  },
  {
    id: 'hours', ask: 'How many hours a week can you spend on it in the growing season?', kind: 'number', unit: 'hours/week',
    answered: (g) => g.hoursPerWeek !== undefined,
    apply: (a) => ({ hoursPerWeek: num(a) }),
  },
  {
    id: 'budget', ask: 'Roughly what could you spend to get started?', help: 'Beds, fencing, water, coop, tools. A range is fine; you can change it later.', kind: 'number', unit: 'USD',
    answered: (g) => g.budgetStartupUsd !== undefined,
    apply: (a) => ({ budgetStartupUsd: num(a) }),
  },
  {
    id: 'space', ask: 'About how much space could go to vegetables?', kind: 'choice',
    options: [
      { value: '100', label: 'A few beds (about 100 sq ft)' }, { value: '500', label: 'A backyard plot (about 500 sq ft)' },
      { value: '2000', label: 'A big garden (about 2,000 sq ft)' }, { value: '10890', label: 'A quarter acre' }, { value: '21780', label: 'Half an acre or more' },
    ],
    answered: (g) => g.gardenSpaceSqFt !== undefined,
    apply: (a) => ({ gardenSpaceSqFt: num(a) }),
  },
  {
    id: 'experience', ask: 'How much growing experience do you have?', kind: 'choice',
    options: [
      { value: 'none', label: 'None yet' }, { value: 'some-gardening', label: 'Some gardening' },
      { value: 'experienced', label: 'Experienced gardener' }, { value: 'livestock', label: 'Gardening and livestock' },
    ],
    answered: (g) => !!g.experience,
    apply: (a) => ({ experience: a as HomesteadGoals['experience'] }),
  },
  {
    id: 'animals', ask: 'Are animals allowed where you live?', help: 'Check your zoning, HOA or lease. Many towns allow hens but not roosters.', kind: 'choice',
    options: [{ value: 'yes', label: 'Yes' }, { value: 'poultry-only', label: 'Poultry only' }, { value: 'no', label: 'No' }, { value: 'unsure', label: 'Not sure yet' }],
    answered: (g) => !!g.animals,
    apply: (a) => ({ animals: a as HomesteadGoals['animals'] }),
  },
  {
    id: 'diet', ask: 'Anything your household doesn’t eat?', kind: 'multi',
    options: [
      { value: 'vegetarian', label: 'Vegetarian' }, { value: 'vegan', label: 'Vegan' }, { value: 'no-pork', label: 'No pork' },
      { value: 'no-dairy', label: 'No dairy' }, { value: 'no-eggs', label: 'No eggs' },
    ],
    answered: (g) => g.diet !== undefined,
    apply: (a) => ({ diet: (a as HomesteadGoals['diet']) ?? [] }),
  },
  {
    id: 'physical', ask: 'Any physical limits to plan around?', help: 'Bending, lifting, long days. Raised beds and small animals help.', kind: 'choice',
    options: [{ value: 'none', label: 'None' }, { value: 'some', label: 'Some' }, { value: 'significant', label: 'Significant' }],
    answered: (g) => !!g.physical,
    apply: (a) => ({ physical: a as HomesteadGoals['physical'] }),
  },
  {
    id: 'animalInterest', ask: 'Which animals interest you?', kind: 'multi',
    options: [
      { value: 'laying_hens', label: 'Laying hens' }, { value: 'meat_chickens', label: 'Meat chickens' }, { value: 'ducks_layers', label: 'Ducks' },
      { value: 'honeybees', label: 'Honeybees' }, { value: 'meat_rabbits', label: 'Meat rabbits' }, { value: 'dairy_goats', label: 'Dairy goats' },
      { value: 'meat_goats', label: 'Meat goats' }, { value: 'sheep', label: 'Sheep' }, { value: 'feeder_pigs', label: 'Pigs' }, { value: 'turkeys', label: 'Turkeys' },
    ],
    relevant: (g) => g.animals !== 'no',
    answered: (g) => g.animalInterest !== undefined,
    apply: (a) => ({ animalInterest: (a as string[]) ?? [] }),
  },
  {
    id: 'water', ask: 'Where would garden water come from?', kind: 'choice',
    options: [
      { value: 'municipal', label: 'City/municipal water' }, { value: 'well', label: 'A well' }, { value: 'rain-only', label: 'Rain barrels / catchment only' },
      { value: 'none', label: 'No water there yet' }, { value: 'unsure', label: 'Not sure' },
    ],
    answered: (g) => !!g.water,
    apply: (a) => ({ water: a as HomesteadGoals['water'] }),
  },
  {
    id: 'preserve', ask: 'Would you can, freeze or dry food for winter?', kind: 'boolean',
    relevant: (g) => g.ambition !== undefined && g.ambition !== 'kitchen',
    answered: (g) => g.willPreserve !== undefined,
    apply: (a) => ({ willPreserve: !!a }),
  },
  {
    id: 'income', ask: 'Would you like the homestead to earn some money?', kind: 'boolean',
    answered: (g) => g.wantsIncome !== undefined,
    apply: (a) => ({ wantsIncome: !!a }),
  },
  {
    id: 'market', ask: 'How easy is it to reach buyers (farmers markets, restaurants, neighbours)?', kind: 'choice',
    options: [{ value: 'none', label: 'Hard: rural, few buyers' }, { value: 'some', label: 'Some options nearby' }, { value: 'strong', label: 'Easy: markets and customers nearby' }],
    relevant: (g) => g.wantsIncome === true,
    answered: (g) => !!g.marketAccess,
    apply: (a) => ({ marketAccess: a as HomesteadGoals['marketAccess'] }),
  },
];

/** The next unanswered questions (at most `max`, default 3), most important first. */
export function nextQuestions(g: HomesteadGoals, max = 3): Question[] {
  return QUESTIONS.filter((q) => (q.relevant ? q.relevant(g) : true) && !q.answered(g)).slice(0, Math.min(3, max));
}

/** The minimum needed before recommending: household, food ambition, hours, budget and space. */
export const ESSENTIAL = ['household', 'ambition', 'hours', 'budget', 'space'];
export function readyToPlan(g: HomesteadGoals): boolean {
  return ESSENTIAL.every((id) => QUESTIONS.find((q) => q.id === id)!.answered(g));
}

export function interviewProgress(g: HomesteadGoals): { answered: number; total: number } {
  const rel = QUESTIONS.filter((q) => (q.relevant ? q.relevant(g) : true));
  return { answered: rel.filter((q) => q.answered(g)).length, total: rel.length };
}
