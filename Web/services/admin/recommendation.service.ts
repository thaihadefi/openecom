import Order from "../../models/order.model";
import Product from "../../models/product.model";
import { computeItemBasedCf, applyDiversityCap, DiversityCandidate } from "../../helpers/recommendation.helper";
import { invalidateProductCaches } from "../../helpers/metadata-cache.helper";
import { RECOMMENDATION_CONFIG } from "../../configs/recommendation.config";
import { ICfRecommendation } from "../../interfaces/models/product.interface";

export const recomputeProductRecommendations = async () => {
  const since = new Date(Date.now() - RECOMMENDATION_CONFIG.TRAINING_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const orders = await Order.find({
    deleted: false,
    orderStatus: { $in: RECOMMENDATION_CONFIG.TRAINING_ORDER_STATUSES },
    createdAt: { $gte: since }
  }).select("items.productId createdAt");

  const cfOrders = orders.map((order) => ({
    items: (order.items || []).map((item) => String(item.productId)).filter(Boolean),
    createdAt: order.createdAt
  }));

  const candidatePool = computeItemBasedCf(
    cfOrders,
    RECOMMENDATION_CONFIG.TOP_N * RECOMMENDATION_CONFIG.CANDIDATE_POOL_MULTIPLIER
  );

  const allActiveProducts = await Product.find({
    deleted: false,
    status: "active"
  }).select("category view cfRecommendations").sort({ view: -1 }).lean();

  const categoryByProductId = new Map(
    allActiveProducts.map((p) => [String(p._id), Array.from(new Set((p.category || []).map(String))).sort()])
  );

  // The category score depends only on a product's set of categories, so products are grouped by it.
  const groupsBySignature = new Map<string, { categories: string[]; productIds: string[] }>();
  const signaturesByCategory = new Map<string, Set<string>>();
  for (const [pId, categories] of categoryByProductId) {
    if (categories.length === 0) continue;
    const signature = categories.join("|");
    if (!groupsBySignature.has(signature)) {
      groupsBySignature.set(signature, { categories, productIds: [] });
      for (const cat of categories) {
        if (!signaturesByCategory.has(cat)) signaturesByCategory.set(cat, new Set());
        signaturesByCategory.get(cat)!.add(signature);
      }
    }
    groupsBySignature.get(signature)!.productIds.push(pId);
  }

  // Fills short co-purchase lists from shared categories. A group's members all score the same, so the
  // top `needed` of each group (most viewed first) are the only ones that can be picked.
  const topUpFromSharedCategories = (productId: string, picked: DiversityCandidate[]): ICfRecommendation[] => {
    const currentCategories = new Set(categoryByProductId.get(productId));
    const needed = RECOMMENDATION_CONFIG.TOP_N - picked.length;
    if (needed <= 0 || currentCategories.size === 0) return [];

    const excludedIds = new Set([productId, ...picked.map((p) => p.productId)]);
    const relatedSignatures = new Set<string>();
    for (const cat of currentCategories) {
      for (const signature of signaturesByCategory.get(cat)!) relatedSignatures.add(signature);
    }

    const candidates: DiversityCandidate[] = [];
    for (const signature of relatedSignatures) {
      const group = groupsBySignature.get(signature)!;
      const sharedCount = group.categories.filter((cat) => currentCategories.has(cat)).length;
      const jaccard = sharedCount / (currentCategories.size + group.categories.length - sharedCount);
      const score = Math.round((0.15 + jaccard * 0.25) * 1000) / 1000;
      candidates.push(
        ...group.productIds
          .filter((id) => !excludedIds.has(id))
          .slice(0, needed)
          .map((id) => ({ productId: id, score, categories: group.categories }))
      );
    }

    return applyDiversityCap(candidates, needed, RECOMMENDATION_CONFIG.MAX_PER_CATEGORY, picked);
  };

  const recommendationsByProduct = new Map<string, ICfRecommendation[]>();

  for (const product of allActiveProducts) {
    const productId = String(product._id);
    const cfCandidates: DiversityCandidate[] = (candidatePool.get(productId) || [])
      .filter((c) => categoryByProductId.has(c.productId))
      .map((c) => ({ productId: c.productId, score: c.score, categories: categoryByProductId.get(c.productId)! }));
    const candidateById = new Map(cfCandidates.map((c) => [c.productId, c]));

    const cfPicked = applyDiversityCap(cfCandidates, RECOMMENDATION_CONFIG.TOP_N, RECOMMENDATION_CONFIG.MAX_PER_CATEGORY);
    const picked = [
      ...cfPicked,
      ...topUpFromSharedCategories(productId, cfPicked.map((r) => candidateById.get(r.productId)!))
    ];

    if (picked.length > 0) {
      recommendationsByProduct.set(productId, picked);
    }
  }

  const staleClearResult = await Product.updateMany(
    {
      cfRecommendations: { $exists: true, $ne: [] },
      _id: { $nin: Array.from(recommendationsByProduct.keys()) }
    },
    { $set: { cfRecommendations: [] } }
  );

  // Skip unchanged lists so the caches stay warm.
  const listKey = (list: ICfRecommendation[] = []) =>
    JSON.stringify(list.map((r) => [r.productId, r.score]));
  const storedKeyById = new Map(allActiveProducts.map((p) => [String(p._id), listKey(p.cfRecommendations)]));

  const bulkOps = Array.from(recommendationsByProduct.entries())
    .filter(([productId, cfRecommendations]) => storedKeyById.get(productId) !== listKey(cfRecommendations))
    .map(([productId, cfRecommendations]) => ({
      updateOne: {
        filter: { _id: productId },
        update: { $set: { cfRecommendations } }
      }
    }));

  if (bulkOps.length === 0) {
    if (staleClearResult.modifiedCount > 0) invalidateProductCaches();
    return { productsUpdated: 0, ordersScanned: orders.length };
  }

  await Product.bulkWrite(bulkOps, { ordered: false });
  invalidateProductCaches();

  return { productsUpdated: bulkOps.length, ordersScanned: orders.length };
};

export interface ManualRecomputeStatus {
  status: "idle" | "running";
  lastRunAt: Date | null;
  lastResult: { productsUpdated: number; ordersScanned: number } | null;
  lastError: string | null;
}

let manualRecomputeStatus: ManualRecomputeStatus = {
  status: "idle",
  lastRunAt: null,
  lastResult: null,
  lastError: null
};

export const getManualRecomputeStatus = (): ManualRecomputeStatus => manualRecomputeStatus;

export const triggerManualRecompute = (): ManualRecomputeStatus => {
  if (manualRecomputeStatus.status === "running") return manualRecomputeStatus;

  manualRecomputeStatus = { ...manualRecomputeStatus, status: "running" };

  (async () => {
    try {
      const result = await recomputeProductRecommendations();
      manualRecomputeStatus = {
        status: "idle",
        lastRunAt: new Date(),
        lastResult: result,
        lastError: null
      };
    } catch (error) {
      manualRecomputeStatus = {
        status: "idle",
        lastRunAt: new Date(),
        lastResult: null,
        lastError: error instanceof Error ? error.message : String(error)
      };
    }
  })();

  return manualRecomputeStatus;
};
