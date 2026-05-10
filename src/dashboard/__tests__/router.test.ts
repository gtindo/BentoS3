import { describe, expect, it } from "vitest";
import { createPaginationHref, paginateItems, parsePaginationPage } from "../router.js";

describe("dashboard router pagination", () => {
  it("defaults missing and invalid page values to the first page", () => {
    expect(parsePaginationPage(new URLSearchParams())).toBe(1);
    expect(parsePaginationPage(new URLSearchParams({ page: "0" }))).toBe(1);
    expect(parsePaginationPage(new URLSearchParams({ page: "not-a-page" }))).toBe(1);
  });

  it("paginates items with the dashboard page size", () => {
    const items = Array.from({ length: 125 }, (_value, index) => index + 1);
    const result = paginateItems(items, new URLSearchParams({ page: "2" }), "/ui/buckets");

    expect(result.items).toEqual(Array.from({ length: 50 }, (_value, index) => index + 51));
    expect(result.pagination).toMatchObject({
      currentPage: 2,
      endItem: 100,
      hasNextPage: true,
      hasPreviousPage: true,
      nextHref: "/ui/buckets?page=3",
      pagePath: "/ui/buckets",
      pageSize: 50,
      previousHref: "/ui/buckets",
      startItem: 51,
      totalItems: 125,
      totalPages: 3,
    });
  });

  it("clamps pages beyond the available range", () => {
    const items = Array.from({ length: 55 }, (_value, index) => index + 1);
    const result = paginateItems(items, new URLSearchParams({ page: "99" }), "/ui/buckets");

    expect(result.items).toEqual([51, 52, 53, 54, 55]);
    expect(result.pagination).toMatchObject({
      currentPage: 2,
      endItem: 55,
      hasNextPage: false,
      hasPreviousPage: true,
      nextHref: "",
      previousHref: "/ui/buckets",
      startItem: 51,
      totalItems: 55,
      totalPages: 2,
    });
  });

  it("uses a clean URL for the first page", () => {
    expect(createPaginationHref("/ui/buckets", 1)).toBe("/ui/buckets");
    expect(createPaginationHref("/ui/buckets", 3)).toBe("/ui/buckets?page=3");
  });
});
