/**
 * The planner's bundled knowledge base (§9.1): every number the planner quotes comes from here or from
 * the parcel's own data, never from a language model.
 *
 *  - nutrition.json: USDA FoodData Central SR Legacy (public domain / CC0) nutrients per 100 g and edible
 *    portions for each crop and homestead animal product; Dietary Guidelines for Americans 2020–2025
 *    energy needs (public domain) and National Academies DRI values (facts, cited).
 *  - homestead.json: livestock, small-enterprise, infrastructure and food-preservation profiles as
 *    sourced ranges from land-grant extension, USDA, SARE/ATTRA and NCHFP publications, each with its
 *    source URL and year. Old figures are flagged (oldData / oldPrice); missing ones are null.
 */
import nutrition from '../knowledge/nutrition.json';
import homestead from '../knowledge/homestead.json';
import consumption from '../knowledge/consumption.json';

import type { ConsumptionKb, HomesteadKb, KnowledgeBase, NutritionKb } from '@plotwright/core';

export const NUTRITION_KB = nutrition as unknown as NutritionKb;
export const HOMESTEAD_KB = homestead as unknown as HomesteadKb;

/** USDA ERS Food Availability per capita (public domain); partial coverage, see its notes. */
export const CONSUMPTION_KB = consumption as unknown as ConsumptionKb;
export const KNOWLEDGE_BASE: KnowledgeBase = { nutrition: NUTRITION_KB, homestead: HOMESTEAD_KB, consumption: CONSUMPTION_KB };
