import { ICfRecommendation } from "../interfaces/models/product.interface";
import { RECOMMENDATION_CONFIG } from "../configs/recommendation.config";

// Item-based CF (Linden, Smith & York, Amazon 2003): sim(i,j) = coOccurrence(i,j) / sqrt(orderCount(i) * orderCount(j)), recency-weighted.

export interface CfOrderInput {
  items: string[];
  createdAt: Date;
}

const recencyWeight = (createdAt: Date, now: Date, recencyHalfLifeDays: number): number => {
  const ageDays = Math.max(0, (now.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000));
  return Math.pow(0.5, ageDays / recencyHalfLifeDays);
};

const bump = (map: Map<string, Map<string, number>>, key: string, subKey: string, amount: number) => {
  if (!map.has(key)) map.set(key, new Map());
  const inner = map.get(key)!;
  inner.set(subKey, (inner.get(subKey) || 0) + amount);
};

export const computeItemBasedCf = (
  orders: CfOrderInput[],
  topN: number,
  now: Date = new Date(),
  minCoOccurrence: number = RECOMMENDATION_CONFIG.MIN_CO_OCCURRENCE,
  recencyHalfLifeDays: number = RECOMMENDATION_CONFIG.RECENCY_HALF_LIFE_DAYS
): Map<string, ICfRecommendation[]> => {
  const weightedOrderCount = new Map<string, number>();
  const rawCoOccurrence = new Map<string, Map<string, number>>();
  const weightedCoOccurrence = new Map<string, Map<string, number>>();

  for (const order of orders) {
    const distinctItems = Array.from(new Set(order.items.filter(Boolean)));
    const weight = recencyWeight(order.createdAt, now, recencyHalfLifeDays);

    for (const item of distinctItems) {
      weightedOrderCount.set(item, (weightedOrderCount.get(item) || 0) + weight);
    }

    if (distinctItems.length < 2) continue;

    for (let i = 0; i < distinctItems.length; i++) {
      for (let j = i + 1; j < distinctItems.length; j++) {
        const a = distinctItems[i];
        const b = distinctItems[j];
        bump(rawCoOccurrence, a, b, 1);
        bump(rawCoOccurrence, b, a, 1);
        bump(weightedCoOccurrence, a, b, weight);
        bump(weightedCoOccurrence, b, a, weight);
      }
    }
  }

  const result = new Map<string, ICfRecommendation[]>();

  for (const [productId, neighbors] of weightedCoOccurrence.entries()) {
    const productWeightedCount = weightedOrderCount.get(productId) || 0;
    if (productWeightedCount === 0) continue;

    const rawNeighbors = rawCoOccurrence.get(productId);
    const scored: ICfRecommendation[] = [];

    for (const [neighborId, weightedCoCount] of neighbors.entries()) {
      const rawCoCount = rawNeighbors?.get(neighborId) || 0;
      if (rawCoCount < minCoOccurrence) continue;

      const neighborWeightedCount = weightedOrderCount.get(neighborId) || 0;
      if (neighborWeightedCount === 0) continue;

      const score = weightedCoCount / Math.sqrt(productWeightedCount * neighborWeightedCount);
      scored.push({ productId: neighborId, score });
    }

    scored.sort((a, b) => b.score - a.score);
    result.set(productId, scored.slice(0, topN));
  }

  return result;
};

export interface DiversityCandidate {
  productId: string;
  score: number;
  categories: string[];
}

export const applyDiversityCap = (
  candidates: DiversityCandidate[],
  topN: number,
  maxPerCategory: number,
  alreadyPicked: DiversityCandidate[] = []
): ICfRecommendation[] => {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const categoryCounts = new Map<string, number>();
  for (const cat of alreadyPicked.flatMap((c) => c.categories)) {
    categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);
  }
  const picked: DiversityCandidate[] = [];
  const deferred: DiversityCandidate[] = [];

  for (const candidate of sorted) {
    const overCap = candidate.categories.some((cat) => (categoryCounts.get(cat) || 0) >= maxPerCategory);
    if (overCap) {
      deferred.push(candidate);
      continue;
    }
    picked.push(candidate);
    for (const cat of candidate.categories) {
      categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);
    }
    if (picked.length >= topN) break;
  }

  for (const candidate of deferred) {
    if (picked.length >= topN) break;
    picked.push(candidate);
  }

  return picked.slice(0, topN).map((c) => ({ productId: c.productId, score: c.score }));
};
