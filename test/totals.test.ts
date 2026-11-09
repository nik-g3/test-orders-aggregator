import { describe, expect, it } from "vitest";
import { apiOrder, dailyTotals, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

describe("GET /customers/:id/daily-totals", () => {
  it("суммирует оплаченные заказы по дням в таймзоне клиента", async () => {
    // c_1 — Europe/Moscow (UTC+3): 20:30Z ещё 10-е, 21:30Z уже 11-е
    await postWebhook(ctx.app, apiOrder({ amount: 1000, createdAt: "2026-02-10T20:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ amount: 250, createdAt: "2026-02-10T21:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ amount: "99", createdAt: "2026-02-11T10:00:00Z" }));

    const res = await dailyTotals(ctx.app, "c_1", "2026-02-09", "2026-02-11");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { date: "2026-02-09", total: 0, gross: 0, discount: 0, net: 0 },
      { date: "2026-02-10", total: 1000, gross: 1000, discount: 0, net: 1000 },
      { date: "2026-02-11", total: 349, gross: 349, discount: 0, net: 349 },
    ]);
  });

  it("не учитывает pending и refunded", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 500 }));
    await postWebhook(ctx.app, apiOrder({ amount: 700, status: "pending" }));
    await postWebhook(ctx.app, apiOrder({ amount: 900, status: "refunded" }));
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([{
        date: "2026-02-10",
        total: 500,
        gross: 500,
        discount: 0,
        net: 500,
      },
    ]);
  });

  it("учитывает только заказы этого клиента", async () => {
    ctx.api.customers.set("c_2", "Asia/Novosibirsk");
    await postWebhook(ctx.app, apiOrder({ amount: 500 }));
    await postWebhook(ctx.app, apiOrder({ amount: 800, customerId: "c_2" }));
    const res = await dailyTotals(ctx.app, "c_2", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([{
        date: "2026-02-10",
        total: 800,
        gross: 800,
        discount: 0,
        net: 800,
      },
    ]);
  });

  it("таймзона клиента берётся из API один раз", async () => {
    await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    ctx.api.customers.set("c_1", "UTC");
    await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    const { rows } = await ctx.db.query(`SELECT timezone FROM customers WHERE id = 'c_1'`);
    expect(rows[0].timezone).toBe("Europe/Moscow");
  });

  it("валидирует даты", async () => {
    expect((await dailyTotals(ctx.app, "c_1", "2026-02-30", "2026-03-01")).statusCode).toBe(400);
    expect((await dailyTotals(ctx.app, "c_1", "2026-03-02", "2026-03-01")).statusCode).toBe(400);
  });

  it("неизвестный клиент — 404", async () => {
    const res = await dailyTotals(ctx.app, "nobody", "2026-02-10", "2026-02-10");
    expect(res.statusCode).toBe(404);
  });
  it("возвращает gross, discount и net", async () => {
    await postWebhook(
      ctx.app,
      apiOrder({
        amount: 1000,
        amountPaid: 750,
      }),
    );

    const res = await dailyTotals(
      ctx.app,
      "c_1",
      "2026-02-10",
      "2026-02-10",
    );

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        date: "2026-02-10",
        total: 1000,
        gross: 1000,
        discount: 250,
        net: 750,
      },
    ]);
  });

  it("учитывает переход на летнее время", async () => {
    ctx.api.customers.set("c_dst", "Europe/Berlin");

    await postWebhook(
      ctx.app,
      apiOrder({
        customerId: "c_dst",
        amount: 1000,
        createdAt: "2026-03-29T00:30:00Z",
        updatedAt: "2026-03-29T00:30:00Z",
      }),
    );

    await postWebhook(
      ctx.app,
      apiOrder({
        customerId: "c_dst",
        amount: 2000,
        createdAt: "2026-03-29T22:30:00Z",
        updatedAt: "2026-03-29T22:30:00Z",
      }),
    );

    const res = await dailyTotals(
      ctx.app,
      "c_dst",
      "2026-03-29",
      "2026-03-30",
    );

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        date: "2026-03-29",
        total: 1000,
        gross: 1000,
        discount: 0,
        net: 1000,
      },
      {
        date: "2026-03-30",
        total: 2000,
        gross: 2000,
        discount: 0,
        net: 2000,
      },
    ]);
  });
});
