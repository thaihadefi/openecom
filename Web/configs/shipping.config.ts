export const SHIPPING_CONFIG = {
  /** Grams per unit when neither the product nor Settings > Shipping gives a weight */
  DEFAULT_ITEM_WEIGHT_GRAMS: 500,
  /** Retries of a carrier cancellation that failed: first wait, longest wait, attempts before staff take over */
  CANCEL_RETRY_BASE_MINUTES: 5,
  CANCEL_RETRY_MAX_MINUTES: 360,
  CANCEL_RETRY_MAX_ATTEMPTS: 10,
  /** Queued cancellations retried per run of the shipment-cancel job */
  CANCEL_RETRY_BATCH: 20,
} as const;
