import { test } from "node:test";
import assert from "node:assert/strict";
import { computeItemBasedCf } from "../helpers/recommendation.helper";

const NOW = new Date("2026-11-12T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

test("products bought together often are recommended for each other", () => {
  const orders = [
    { items: ["phone", "case"], createdAt: daysAgo(1) },
    { items: ["phone", "case"], createdAt: daysAgo(2) },
    { items: ["phone", "case", "charger"], createdAt: daysAgo(3) },
    { items: ["phone", "charger"], createdAt: daysAgo(4) },
  ];
  const recs = computeItemBasedCf(orders, 8, NOW, 2, 30);
  const forPhone = recs.get("phone")!.map((r) => r.productId);
  assert.deepEqual(forPhone, ["case", "charger"]);
  assert.equal(recs.get("case")![0].productId, "phone");
});

test("pairs seen fewer times than the minimum are left out", () => {
  const orders = [
    { items: ["phone", "case"], createdAt: daysAgo(1) },
    { items: ["phone", "case"], createdAt: daysAgo(1) },
    { items: ["phone", "lamp"], createdAt: daysAgo(1) },
  ];
  const forPhone = computeItemBasedCf(orders, 8, NOW, 2, 30).get("phone")!.map((r) => r.productId);
  assert.deepEqual(forPhone, ["case"]);
});

test("recent orders weigh more than old ones", () => {
  // Same counts, but the phone-case pairs are recent and the phone-charger pairs are a year old.
  const orders = [
    { items: ["phone", "case"], createdAt: daysAgo(1) },
    { items: ["phone", "case"], createdAt: daysAgo(2) },
    { items: ["phone", "charger"], createdAt: daysAgo(365) },
    { items: ["phone", "charger"], createdAt: daysAgo(366) },
  ];
  const forPhone = computeItemBasedCf(orders, 8, NOW, 2, 30).get("phone")!;
  assert.equal(forPhone[0].productId, "case");
  assert.ok(forPhone[0].score > forPhone[1].score);
});

test("topN limits the list", () => {
  const orders = Array.from({ length: 2 }, () => ({ items: ["a", "b", "c", "d"], createdAt: daysAgo(1) }));
  assert.equal(computeItemBasedCf(orders, 2, NOW, 2, 30).get("a")!.length, 2);
});
