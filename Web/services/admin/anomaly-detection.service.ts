import Order from "../../models/order.model";
import AccountUser from "../../models/account-user.model";
import { IsolationForest } from "../../helpers/isolation-forest.helper";
import {
  identityOf,
  discountRatioOf,
  buildFeatureVector,
  toVector,
  computeRecentOrderCounts,
  computeCouponVelocity,
  computeDistinctAccountsPerPhone,
  computeDistinctAccountsPerIp,
  countOtherAccounts,
  publicIpOf
} from "../../helpers/order-anomaly-features.helper";
import { getPagination } from "../../helpers/pagination.helper";
import { PAGINATION } from "../../configs/pagination.config";
import { ANOMALY_DETECTION_CONFIG } from "../../configs/anomaly-detection.config";

const {
  TRAINING_LOOKBACK_DAYS,
  MIN_ORDERS_TO_TRAIN,
  NUM_TREES,
  SAMPLE_SIZE,
  ANOMALY_THRESHOLD,
  TRAINING_ORDER_STATUSES,
  RECENT_WINDOW_MINUTES,
  RULE_VELOCITY_ORDER_COUNT,
  RULE_VELOCITY_DISCOUNT_RATIO,
  RULE_COUPON_STAMPEDE_COUNT,
  RULE_PHONE_REUSE_COUNT,
  RULE_IP_REUSE_COUNT,
  IP_REUSE_WINDOW_MINUTES,
  BACKFILL_LOOKBACK_DAYS,
  BACKFILL_BATCH_SIZE,
  UNTRAINED_RETRY_MINUTES
} = ANOMALY_DETECTION_CONFIG;

let forest = new IsolationForest(NUM_TREES, SAMPLE_SIZE);

let inFlightTraining: ReturnType<typeof runTraining> | null = null;

export const trainAnomalyModel = (): ReturnType<typeof runTraining> => {
  if (!inFlightTraining) {
    inFlightTraining = runTraining().finally(() => {
      inFlightTraining = null;
    });
  }
  return inFlightTraining;
};

const runTraining = async () => {
  const since = new Date(Date.now() - TRAINING_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const contextOrders = await Order.find({ deleted: false, createdAt: { $gte: since } })
    .select("userId phone ip coupon discount subTotal orderStatus createdAt")
    .sort({ createdAt: 1 });

  const recentOrderCounts = computeRecentOrderCounts(
    contextOrders.map((o) => ({ identity: identityOf(o), createdAt: o.createdAt })),
    RECENT_WINDOW_MINUTES
  );
  const couponVelocities = computeCouponVelocity(
    contextOrders.map((o) => ({ coupon: o.coupon, createdAt: o.createdAt })),
    RECENT_WINDOW_MINUTES
  );
  const phoneAccountReuses = computeDistinctAccountsPerPhone(
    contextOrders.map((o) => ({ phone: o.phone, userId: o.userId, createdAt: o.createdAt }))
  );
  const ipAccountReuses = computeDistinctAccountsPerIp(
    contextOrders.map((o) => ({ ip: o.ip, userId: o.userId, createdAt: o.createdAt }))
  );

  const trainingStatuses = new Set<string>(TRAINING_ORDER_STATUSES);
  const trainingRows = contextOrders
    .map((o, index) => ({ o, index }))
    .filter(({ o }) => trainingStatuses.has(o.orderStatus || ""));

  if (trainingRows.length < MIN_ORDERS_TO_TRAIN) {
    return { trained: false, ordersUsed: trainingRows.length };
  }

  const userIds = [...new Set(trainingRows.map(({ o }) => o.userId).filter(Boolean).map(String))];
  const accounts = await AccountUser.find({ _id: { $in: userIds } }).select("_id createdAt");
  const accountCreatedAtMap = new Map(accounts.map((a) => [String(a._id), a.createdAt]));

  const vectors = trainingRows.map(({ o, index }) =>
    toVector(
      buildFeatureVector(
        {
          identity: identityOf(o),
          createdAt: o.createdAt,
          discountRatio: discountRatioOf(o),
          isGuest: !o.userId,
          accountCreatedAt: o.userId ? accountCreatedAtMap.get(String(o.userId)) : undefined
        },
        {
          recentOrderCount: recentOrderCounts[index],
          couponVelocity: couponVelocities[index],
          phoneAccountReuse: phoneAccountReuses[index],
          ipAccountReuse: ipAccountReuses[index]
        }
      )
    )
  );

  const newForest = new IsolationForest(NUM_TREES, SAMPLE_SIZE);
  newForest.fit(vectors);
  forest = newForest;

  return { trained: true, ordersUsed: trainingRows.length };
};

// Stops a store with too few orders from rescanning its history on every checkout.
let lastUntrainedAttemptAt = 0;

const ensureModelTrained = async (): Promise<boolean> => {
  if (forest.isTrained()) return true;
  if (Date.now() - lastUntrainedAttemptAt < UNTRAINED_RETRY_MINUTES * 60000) return false;
  const result = await trainAnomalyModel();
  if (!result.trained) lastUntrainedAttemptAt = Date.now();
  return forest.isTrained();
};

export const scoreOrderForAnomaly = async (orderId: string) => {
  const modelReady = await ensureModelTrained();

  const order = await Order.findById(orderId).select("userId phone ip coupon discount subTotal createdAt");
  if (!order) return;

  const createdAt = order.createdAt;
  const windowStart = new Date(createdAt.getTime() - RECENT_WINDOW_MINUTES * 60000);
  const reuseWindowStart = new Date(createdAt.getTime() - TRAINING_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const ipWindowStart = new Date(createdAt.getTime() - IP_REUSE_WINDOW_MINUTES * 60000);
  const identityFilter = order.userId
    ? { userId: order.userId }
    : order.phone
      ? { phone: order.phone, userId: { $in: ["", null] } }
      : null;

  const publicIp = publicIpOf(order.ip);
  const userId = order.userId ? String(order.userId) : undefined;

  const [recentOrderCount, couponVelocity, phoneAccountReuse, ipAccountReuse, account] = await Promise.all([
    identityFilter
      ? Order.countDocuments({
          deleted: false,
          _id: { $ne: order._id },
          createdAt: { $gte: windowStart, $lt: createdAt },
          ...identityFilter
        })
      : Promise.resolve(0),
    order.coupon
      ? Order.countDocuments({
          deleted: false,
          _id: { $ne: order._id },
          coupon: order.coupon,
          createdAt: { $gte: windowStart, $lt: createdAt }
        })
      : Promise.resolve(0),
    order.phone
      ? Order.distinct("userId", {
          deleted: false,
          phone: order.phone,
          userId: { $exists: true, $nin: [null, ""] },
          createdAt: { $gte: reuseWindowStart, $lt: createdAt }
        }).then((ids) => countOtherAccounts(new Set(ids.map(String)), userId))
      : Promise.resolve(0),
    publicIp
      ? Order.distinct("userId", {
          deleted: false,
          ip: publicIp,
          userId: { $exists: true, $nin: [null, ""] },
          createdAt: { $gte: ipWindowStart, $lt: createdAt }
        }).then((ids) => countOtherAccounts(new Set(ids.map(String)), userId))
      : Promise.resolve(0),
    order.userId ? AccountUser.findById(order.userId).select("createdAt") : Promise.resolve(null)
  ]);

  const discountRatio = discountRatioOf(order);
  const featureVector = buildFeatureVector(
    {
      identity: identityOf(order),
      createdAt,
      discountRatio,
      isGuest: !order.userId,
      accountCreatedAt: account ? account.createdAt : undefined
    },
    { recentOrderCount, couponVelocity, phoneAccountReuse, ipAccountReuse }
  );

  // Without a trained model the rules still run, but the order stays unscored so backfill revisits it.
  const score = modelReady ? forest.score(toVector(featureVector)) : null;

  const matchedRules: string[] = [];
  if (recentOrderCount >= RULE_VELOCITY_ORDER_COUNT && discountRatio >= RULE_VELOCITY_DISCOUNT_RATIO) {
    matchedRules.push("velocity_discount_rule");
  }
  if (couponVelocity >= RULE_COUPON_STAMPEDE_COUNT) {
    matchedRules.push("coupon_stampede_rule");
  }
  if (phoneAccountReuse >= RULE_PHONE_REUSE_COUNT) {
    matchedRules.push("phone_reuse_rule");
  }
  if (ipAccountReuse >= RULE_IP_REUSE_COUNT) {
    matchedRules.push("ip_reuse_rule");
  }

  const isAnomalous = matchedRules.length > 0 || (score !== null && score >= ANOMALY_THRESHOLD);
  const anomalyReason = matchedRules.length > 0 ? matchedRules.join("+") : isAnomalous ? "ml_score" : null;

  await Order.updateOne(
    { _id: order._id },
    modelReady
      ? { $set: { anomalyScore: score, isAnomalous, anomalyReason, anomalyScoredAt: new Date() } }
      : { $set: { anomalyScore: null, isAnomalous, anomalyReason }, $unset: { anomalyScoredAt: "" } }
  );
};

export const backfillMissedScoring = async () => {
  if (!(await ensureModelTrained())) return { backfilled: 0 };

  const since = new Date(Date.now() - BACKFILL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const missed = await Order.find({
    deleted: false,
    createdAt: { $gte: since },
    anomalyScoredAt: { $exists: false }
  }).select("_id");

  for (let i = 0; i < missed.length; i += BACKFILL_BATCH_SIZE) {
    const batch = missed.slice(i, i + BACKFILL_BATCH_SIZE);
    await Promise.all(batch.map((order) => scoreOrderForAnomaly(String(order._id))));
  }

  return { backfilled: missed.length };
};

export const getFlaggedOrders = async (rawPage?: unknown) => {
  const filter = { isAnomalous: true, deleted: false, anomalyDismissedAt: { $exists: false } };

  const totalRecord = await Order.countDocuments(filter);
  const pagination = getPagination(rawPage, PAGINATION.ADMIN_LIMIT, totalRecord);

  const recordList = await Order.find(filter)
    .select("code fullName phone total anomalyScore anomalyReason createdAt orderStatus")
    .sort({ anomalyScore: -1, createdAt: -1 })
    .skip(pagination.skip)
    .limit(pagination.limitItems);

  return { recordList, pagination };
};

export const dismissAnomalyFlag = async (orderId: string) => {
  const result = await Order.updateOne(
    { _id: orderId, isAnomalous: true },
    { $set: { anomalyDismissedAt: new Date() } }
  );
  return { dismissed: result.modifiedCount > 0 };
};

export interface ManualRetrainStatus {
  status: "idle" | "running";
  lastRunAt: Date | null;
  lastResult: { trained: boolean; ordersUsed: number; backfilled: number } | null;
  lastError: string | null;
}

let manualRetrainStatus: ManualRetrainStatus = {
  status: "idle",
  lastRunAt: null,
  lastResult: null,
  lastError: null
};

export const getManualRetrainStatus = (): ManualRetrainStatus => manualRetrainStatus;

export const triggerManualRetrain = (): ManualRetrainStatus => {
  if (manualRetrainStatus.status === "running") return manualRetrainStatus;

  manualRetrainStatus = { ...manualRetrainStatus, status: "running" };

  (async () => {
    try {
      const result = await trainAnomalyModel();
      const backfill = result.trained ? await backfillMissedScoring() : { backfilled: 0 };
      manualRetrainStatus = {
        status: "idle",
        lastRunAt: new Date(),
        lastResult: { trained: result.trained, ordersUsed: result.ordersUsed, backfilled: backfill.backfilled },
        lastError: null
      };
    } catch (error) {
      manualRetrainStatus = {
        status: "idle",
        lastRunAt: new Date(),
        lastResult: null,
        lastError: error instanceof Error ? error.message : String(error)
      };
    }
  })();

  return manualRetrainStatus;
};
