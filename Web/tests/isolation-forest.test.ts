import { test } from "node:test";
import assert from "node:assert/strict";
import { IsolationForest, averagePathLength } from "../helpers/isolation-forest.helper";

// A tight grid of normal orders (two features), the shape the fraud model trains on.
const normalOrders: number[][] = [];
for (let x = 0; x < 20; x++) for (let y = 0; y < 20; y++) normalOrders.push([x / 10, y / 10]);

test("average path length matches the formula of Liu et al.", () => {
  assert.equal(averagePathLength(1), 0);
  assert.equal(averagePathLength(2), 1);
  assert.ok(averagePathLength(256) > averagePathLength(16));
});

test("an untrained forest says so", () => {
  assert.equal(new IsolationForest().isTrained(), false);
});

test("an outlier scores clearly higher than a normal order", () => {
  const forest = new IsolationForest(100, 128);
  forest.fit(normalOrders);
  assert.equal(forest.isTrained(), true);
  const normal = forest.score([1, 1]);
  const outlier = forest.score([50, 50]);
  assert.ok(outlier > normal + 0.1, `outlier ${outlier} vs normal ${normal}`);
  assert.ok(outlier > 0.6, `outlier score ${outlier} should signal an anomaly`);
});
