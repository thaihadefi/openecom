export const ANOMALY_DETECTION_CONFIG = {
  TRAINING_LOOKBACK_DAYS: 60,
  MIN_ORDERS_TO_TRAIN: 10,
  NUM_TREES: 200,
  SAMPLE_SIZE: 256,
  // Liu, Ting & Zhou (2008): scores well above 0.5 indicate anomalies.
  ANOMALY_THRESHOLD: 0.60,
  TRAINING_ORDER_STATUSES: ["confirmed", "shipping", "completed"],
  RECENT_WINDOW_MINUTES: 15,
  RULE_VELOCITY_ORDER_COUNT: 2,
  RULE_VELOCITY_DISCOUNT_RATIO: 0.3,
  RULE_COUPON_STAMPEDE_COUNT: 5,
  // Reuse counts leave out the buyer's own account.
  RULE_PHONE_REUSE_COUNT: 1,
  RULE_IP_REUSE_COUNT: 2,
  // Public IPs change hands and sit behind carrier NAT, so they are compared over a day, not the whole window.
  IP_REUSE_WINDOW_MINUTES: 60 * 24,
  BACKFILL_LOOKBACK_DAYS: 14,
  BACKFILL_BATCH_SIZE: 20,
  // Pause before retrying a training run that had too few orders.
  UNTRAINED_RETRY_MINUTES: 30,
  GUEST_ACCOUNT_AGE_MINUTES: 60 * 24 * 90,
} as const;
