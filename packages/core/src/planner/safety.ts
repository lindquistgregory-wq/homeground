/**
 * Safety rules for the planner (§9.2): no pesticide mixing beyond the label, no veterinary or medical
 * diagnosis, and never a green light for eating foraged plants or mushrooms. Applied to user questions
 * (so a model never has to decide) and to model replies (as a backstop).
 */
export type SafetyTopic = 'pesticide' | 'veterinary' | 'foraging' | 'medical';

const RULES: Array<{ topic: SafetyTopic; re: RegExp }> = [
  { topic: 'foraging', re: /\b(forag|wild mushroom|is (this|it) (safe|ok|okay) to eat|can i eat (this|these|wild)|edible (mushroom|plant|berr)|identify (this )?(mushroom|plant|berr))/i },
  { topic: 'pesticide', re: /\b(mix|mixing|combine|dilut|tank[- ]?mix|how much|ratio|dose|dosage|strength|concentrat)\w*\b.*\b(pesticide|herbicide|insecticide|fungicide|roundup|glyphosate|sevin|carbaryl|malathion|permethrin|copper sulfate|neem|spray)/i },
  { topic: 'veterinary', re: /\b(my|our|the) (hen|chicken|duck|goat|sheep|pig|rabbit|cow|turkey|dog|cat|bird|doe|ewe|kid|lamb|chick)s?\b.*\b(sick|ill|limp|letharg|bloat|diarrh|not eating|dying|injur|wound|swollen|cough|sneez|what('s| is) wrong|dose|medicat|antibiotic|dewormer|ivermectin)/i },
  { topic: 'medical', re: /\b(i|we|my (son|daughter|kid|child|wife|husband))\b.*\b(ate|poison|allergic|rash|sting|bitten)\b|\bmedical advice\b/i },
];

export const SAFETY_REPLY: Record<SafetyTopic, string> = {
  foraging: 'I can’t tell you whether a wild plant or mushroom is safe to eat. Photos and app descriptions aren’t reliable enough, and some poisonous species look like edible ones. Ask a local expert in person, such as your extension office or a mycological society, and never eat anything you can’t identify with certainty.',
  pesticide: 'For any pesticide, herbicide or fungicide, follow the product label exactly: the label is the law and sets the rate, mixing and protective gear. I won’t suggest other mixes or strengths. Your extension office can recommend a product for a specific pest.',
  veterinary: 'That sounds like it needs a vet. I can’t diagnose or dose animals. Separate a sick animal from the others, keep it warm, with water, and call a vet (your extension office can point you to one who sees farm animals).',
  medical: 'For a possible poisoning, sting or allergic reaction, call Poison Control (1-800-222-1222 in the US) or emergency services. I can’t give medical advice.',
};

/** Which safety rule a message falls under, if any. */
export function safetyTopic(text: string): SafetyTopic | null {
  for (const r of RULES) if (r.re.test(text)) return r.topic;
  return null;
}

/** Backstop on model output: replace replies that give mixing ratios, doses or edibility verdicts. */
export function screenReply(reply: string): { reply: string; replaced?: SafetyTopic } {
  if (/\b\d+(\.\d+)?\s*(ml|oz|tbsp|tsp|cc|mg)\b.*\b(per|\/)\s*(gallon|gal|liter|litre|lb|kg)\b/i.test(reply) && /pesticide|herbicide|insecticide|fungicide|spray|dewormer|antibiotic/i.test(reply)) {
    return { reply: SAFETY_REPLY.pesticide, replaced: 'pesticide' };
  }
  if (/\b(is|are) (safe|edible) to eat\b/i.test(reply) && /mushroom|wild|forag/i.test(reply)) return { reply: SAFETY_REPLY.foraging, replaced: 'foraging' };
  return { reply };
}
