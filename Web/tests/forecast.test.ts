import { test } from "node:test";
import assert from "node:assert/strict";
import { computeReorderForecast, holtLinearForecast, winsorizeSeries } from "../helpers/forecast.helper";

test("Holt's method follows a straight trend exactly", () => {
  const series = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const result = holtLinearForecast(series);
  assert.ok(Math.abs(result.level - 10) < 1e-9);
  assert.ok(Math.abs(result.trend - 1) < 1e-9);
  assert.ok(Math.abs(result.forecast - 11) < 1e-9);
});

test("Holt's method never forecasts negative demand", () => {
  assert.equal(holtLinearForecast([5, 3, 1, 0, 0]).forecast >= 0, true);
  assert.deepEqual(holtLinearForecast([]), { level: 0, trend: 0, forecast: 0 });
});

test("a sales spike is capped before forecasting", () => {
  const capped = winsorizeSeries([2, 2, 2, 2, 2, 2, 2, 2, 2, 100], 90);
  assert.ok(Math.max(...capped) < 100);
});

test("reorder point = demand during lead time + safety stock", () => {
  // Constant demand of 2 a day: no variance, so no safety stock.
  const result = computeReorderForecast(Array(10).fill(2), 5, 3, 7);
  assert.equal(result.insufficientData, false);
  assert.ok(Math.abs(result.forecastedDailyDemand - 2) < 1e-9);
  assert.ok(Math.abs(result.reorderPoint - 6) < 1e-9);
  assert.equal(result.needsReorder, true);
  // Target covers lead time + review period: 2 x (3 + 7) = 20, minus 5 in stock.
  assert.equal(result.suggestedReorderQty, 15);
});

test("too few sale days fall back to the plain average", () => {
  const result = computeReorderForecast([0, 0, 4, 0, 0, 0, 0, 0, 0, 0], 100, 3, 7);
  assert.equal(result.insufficientData, true);
  assert.ok(Math.abs(result.forecastedDailyDemand - 0.4) < 1e-9);
  assert.equal(result.needsReorder, false);
});
