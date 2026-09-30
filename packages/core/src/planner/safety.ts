/**
 * Safety rules for the planner (§9.2): no pesticide mixing beyond the label, no veterinary or medical
 * diagnosis, and never a green light for eating foraged plants or mushrooms. Applied to user questions
 * (so a model never has to decide) and to model replies (as a backstop).
 */
export type SafetyTopic = 'pesticide' | 'veterinary' | 'foraging' | 'medical';

const PRODUCT = /\b(pesticides?|herbicides?|insecticides?|fungicides?|miticides?|roundup|glyphosate|sevin|carbaryl|malathion|permethrin|pyrethrins?|spinosad|neem|copper (fungicide|sulfate|spray)|sulfur spray|diazinon|2,?4-?d|bt spray|weed ?killer|bug spray)\b/i;
const AMOUNT = /\b(mix|mixing|combine|combining|dilut\w*|tank[- ]?mix|how (much|many|strong)|ratio|dose|dosage|strength|stronger|double|triple|concentrat\w*|tablespoons?|tbsp|teaspoons?|tsp|ounces?|oz|ml|cups?|per (gallon|gal|liter|litre))\b/i;
const NOT_USING = /\b(no|without|avoid(ing)?|instead of|free of|free from|not use|don'?t use|never use)\s+(any\s+|using\s+)?(chemical\s+)?(pesticides?|herbicides?|insecticides?|fungicides?|sprays?|chemicals?)\b/i;

const ANIMAL = /\b(hens?|chickens?|chicks?|roosters?|ducks?|ducklings?|geese|goose|goats?|doelings?|bucklings?|sheep|lambs?|ewes?|rams?|pigs?|piglets?|hogs?|sows?|rabbits?|bunn(y|ies)|turkeys?|poults?|cows?|calf|calves|cattle|horses?|donkeys?|llamas?|alpacas?|dogs?|cats?|flock|herd|livestock|poultry)\b/i;
const ILLNESS = /\b(sick|ill|limp\w*|letharg\w*|bloat\w*|diarrh\w*|scour\w*|not eating|off (its |their )?feed|dying|died|injur\w*|wound\w*|swollen|swelling|cough\w*|sneez\w*|wheez\w*|what('s| is) wrong|dose|dosage|medicat\w*|antibiotics?|de-?worm\w*|dewormer|ivermectin|fenbendazole|albendazole|penicillin|oxytetracycline|treat|treating|treatment|bumblefoot|mites|lice|prolapse\w*|egg[- ]?bound|mastitis|wry neck|coccidiosis|vaccin\w*|infect\w*|abscess\w*|parasites?)\b/i;

const WILD = /\b(wild|foraged?|foraging|from (my|the|our) (yard|woods|lawn|forest|field|pasture)|in (my|the|our) (woods|yard|lawn|forest))\b/i;
const FUNGI = /\b(mushrooms?|morels?|chanterelles?|puffballs?|toadstools?|fungus|fungi|boletes?|chicken of the woods|hen of the woods)\b/i;
const RISKY_PLANTS = /\b(dandelions?|pokeweed|poke ?salad|elderberr\w*|nightshade|hemlock|acorns?|ramps|fiddleheads?|purslane|lambs?-?quarters?|nettles?|milkweed|jimson ?weed|may ?apples?|wild (carrots?|parsnips?|garlic|onions?|berries|greens|plants?))\b/i;
const EAT = /\b(eat|eating|edible|safe to eat|poison\w*|toxic|raw|cook them|consume)\b/i;

const EXPOSURE = /\b(ate|eaten|swallowed|drank|stung|bitten|bit me|got (sprayed|splashed)|inhaled|licked)\b/i;
const HARM = /\b(poison\w*|toxic|allergic|reaction|rash|swell\w*|sick|vomit\w*|hospital|emergency|symptoms?|numb|dizzy|can'?t breathe)\b/i;

function matches(topic: SafetyTopic, t: string): boolean {
  switch (topic) {
    case 'pesticide':
      return PRODUCT.test(t) && AMOUNT.test(t) && !NOT_USING.test(t);
    case 'veterinary':
      return ANIMAL.test(t) && ILLNESS.test(t);
    case 'foraging':
      return (FUNGI.test(t) && EAT.test(t)) || (RISKY_PLANTS.test(t) && EAT.test(t)) || (WILD.test(t) && EAT.test(t)) || /\bwhich (berries|plants|mushrooms|weeds)\b.*\b(edible|eat|safe)\b/i.test(t);
    case 'medical':
      return (EXPOSURE.test(t) && HARM.test(t)) || /\bmedical advice\b/i.test(t);
  }
}

const ORDER: SafetyTopic[] = ['pesticide', 'veterinary', 'foraging', 'medical'];

export const SAFETY_REPLY: Record<SafetyTopic, string> = {
  foraging: 'I can’t tell you whether a wild plant or mushroom is safe to eat. Photos and app descriptions aren’t reliable enough, and some poisonous species look like edible ones. Ask a local expert in person, such as your extension office or a mycological society, and never eat anything you can’t identify with certainty.',
  pesticide: 'For any pesticide, herbicide or fungicide, follow the product label exactly: the label is the law and sets the rate, mixing and protective gear. I won’t suggest other mixes or strengths. Your extension office can recommend a product for a specific pest.',
  veterinary: 'That sounds like it needs a vet. I can’t diagnose or dose animals. Separate a sick animal from the others, keep it warm, with water, and call a vet (your extension office can point you to one who sees farm animals).',
  medical: 'For a possible poisoning, sting or allergic reaction, call Poison Control (1-800-222-1222 in the US) or emergency services. I can’t give medical advice.',
};

/** Which safety rule a message falls under, if any. */
export function safetyTopic(text: string): SafetyTopic | null {
  for (const topic of ORDER) if (matches(topic, text)) return topic;
  return null;
}

/** Backstop on model output: replace replies that give mixing ratios, doses or edibility verdicts. */
export function screenReply(reply: string): { reply: string; replaced?: SafetyTopic } {
  if (/\b\d+(\.\d+)?\s*(ml|oz|ounces?|tbsp|tablespoons?|tsp|teaspoons?|cc|mg|cups?)\b.*\b(per|\/|in a|for each)\s*(gallon|gal|liter|litre|lb|kg|pounds?)\b/i.test(reply) && (PRODUCT.test(reply) || /spray|dewormer|antibiotic|ivermectin|medicat/i.test(reply))) {
    return { reply: SAFETY_REPLY.pesticide, replaced: 'pesticide' };
  }
  if (/\b(is|are) (safe|edible)( to eat)?\b/i.test(reply) && (FUNGI.test(reply) || WILD.test(reply) || RISKY_PLANTS.test(reply))) return { reply: SAFETY_REPLY.foraging, replaced: 'foraging' };
  return { reply };
}
