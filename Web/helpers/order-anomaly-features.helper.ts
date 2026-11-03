
import { ANOMALY_DETECTION_CONFIG } from "../configs/anomaly-detection.config";

export const identityOf = (order: { userId?: string; phone?: string }): string =>
  order.userId ? String(order.userId) : `guest:${order.phone || "unknown"}`;

export const discountRatioOf = (order: { discount?: number; subTotal?: number }): number =>
  order.subTotal ? (order.discount || 0) / order.subTotal : 0;

export interface OrderFeatureInput {
  identity: string;
  createdAt: Date;
  discountRatio: number;
  isGuest: boolean;
  accountCreatedAt?: Date;
}

export interface OrderVelocityCounts {
  recentOrderCount: number;
  couponVelocity: number;
  phoneAccountReuse: number;
  ipAccountReuse: number;
}

export interface OrderFeatureVector {
  discountRatio: number;
  accountAgeMinutes: number;
  isGuest: number;
  recentOrderCount: number;
  couponVelocity: number;
  phoneAccountReuse: number;
  ipAccountReuse: number;
}

export const buildFeatureVector = (
  input: OrderFeatureInput,
  counts: OrderVelocityCounts,
  guestAccountAgeMinutes: number = ANOMALY_DETECTION_CONFIG.GUEST_ACCOUNT_AGE_MINUTES
): OrderFeatureVector => {
  const rawAgeMinutes = input.accountCreatedAt
    ? Math.max(0, (input.createdAt.getTime() - input.accountCreatedAt.getTime()) / 60000)
    : guestAccountAgeMinutes;
  // Cap at the guest default so a few very old accounts do not become outliers.
  const accountAgeMinutes = Math.min(rawAgeMinutes, guestAccountAgeMinutes);

  return {
    discountRatio: input.discountRatio,
    accountAgeMinutes,
    isGuest: input.isGuest ? 1 : 0,
    recentOrderCount: counts.recentOrderCount,
    couponVelocity: counts.couponVelocity,
    phoneAccountReuse: counts.phoneAccountReuse,
    ipAccountReuse: counts.ipAccountReuse
  };
};

export const toVector = (f: OrderFeatureVector): number[] => [
  f.discountRatio,
  Math.log1p(f.accountAgeMinutes),
  f.isGuest,
  Math.log1p(f.recentOrderCount),
  Math.log1p(f.couponVelocity),
  Math.log1p(f.phoneAccountReuse),
  Math.log1p(f.ipAccountReuse)
];

const computeSlidingWindowCount = (
  items: { key: string | undefined; createdAt: Date }[],
  windowMinutes: number
): number[] => {
  const seenByKey = new Map<string, number[]>();
  const counts: number[] = new Array(items.length).fill(0);

  items.forEach((item, index) => {
    if (!item.key) return;
    const timestamps = seenByKey.get(item.key) || [];
    const windowStart = item.createdAt.getTime() - windowMinutes * 60000;

    let staleCount = 0;
    while (staleCount < timestamps.length && timestamps[staleCount] < windowStart) {
      staleCount++;
    }
    if (staleCount > 0) timestamps.splice(0, staleCount);

    counts[index] = timestamps.length;
    timestamps.push(item.createdAt.getTime());
    seenByKey.set(item.key, timestamps);
  });

  return counts;
};

export const computeRecentOrderCounts = (
  orders: { identity: string; createdAt: Date }[],
  windowMinutes: number = ANOMALY_DETECTION_CONFIG.RECENT_WINDOW_MINUTES
): number[] =>
  computeSlidingWindowCount(
    orders.map((o) => ({ key: o.identity, createdAt: o.createdAt })),
    windowMinutes
  );

export const computeCouponVelocity = (
  orders: { coupon?: string; createdAt: Date }[],
  windowMinutes: number = ANOMALY_DETECTION_CONFIG.RECENT_WINDOW_MINUTES
): number[] =>
  computeSlidingWindowCount(
    orders.map((o) => ({ key: o.coupon, createdAt: o.createdAt })),
    windowMinutes
  );

// Accounts other than the buyer's that used the same phone or IP earlier. A guest is assumed to own
// one of those accounts, so a registered customer checking out as a guest does not count as reuse.
export const countOtherAccounts = (
  accounts: { size: number; has(id: string): boolean },
  userId?: string
): number => {
  if (userId) return accounts.size - (accounts.has(String(userId)) ? 1 : 0);
  return Math.max(0, accounts.size - 1);
};

// Loopback, private and link-local addresses belong to a proxy or the local network, not to a customer.
export const publicIpOf = (ip?: string): string | undefined => {
  if (!ip) return undefined;
  const addr = ip.trim().toLowerCase().replace(/^::ffff:/, "");
  if (addr === "localhost" || addr === "::1" || addr === "::") return undefined;
  const v4 = addr.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    const shared = a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 169 && b === 254);
    return shared ? undefined : ip;
  }
  return /^f[cd]/.test(addr) || /^fe[89ab]/.test(addr) ? undefined : ip;
};

// Orders must be sorted by createdAt. Without a window, every earlier order with the same key counts.
const computeOtherAccountsPerKey = (
  items: { key?: string; userId?: string; createdAt: Date }[],
  windowMinutes?: number
): number[] => {
  const stateByKey = new Map<string, { orders: { userId: string; time: number }[]; start: number; accounts: Map<string, number> }>();
  const counts: number[] = new Array(items.length).fill(0);

  items.forEach((item, index) => {
    if (!item.key) return;
    const time = item.createdAt.getTime();
    let state = stateByKey.get(item.key);
    if (!state) {
      state = { orders: [], start: 0, accounts: new Map() };
      stateByKey.set(item.key, state);
    }

    if (windowMinutes !== undefined) {
      const windowStart = time - windowMinutes * 60000;
      while (state.start < state.orders.length && state.orders[state.start].time < windowStart) {
        const expired = state.orders[state.start++].userId;
        const left = (state.accounts.get(expired) || 0) - 1;
        if (left > 0) state.accounts.set(expired, left);
        else state.accounts.delete(expired);
      }
    }

    counts[index] = countOtherAccounts(state.accounts, item.userId);
    if (item.userId) {
      const userId = String(item.userId);
      state.accounts.set(userId, (state.accounts.get(userId) || 0) + 1);
      if (windowMinutes !== undefined) state.orders.push({ userId, time });
    }
  });

  return counts;
};

export const computeDistinctAccountsPerPhone = (
  orders: { phone?: string; userId?: string; createdAt: Date }[]
): number[] =>
  computeOtherAccountsPerKey(orders.map((o) => ({ key: o.phone, userId: o.userId, createdAt: o.createdAt })));

export const computeDistinctAccountsPerIp = (
  orders: { ip?: string; userId?: string; createdAt: Date }[],
  windowMinutes: number = ANOMALY_DETECTION_CONFIG.IP_REUSE_WINDOW_MINUTES
): number[] =>
  computeOtherAccountsPerKey(
    orders.map((o) => ({ key: publicIpOf(o.ip), userId: o.userId, createdAt: o.createdAt })),
    windowMinutes
  );
