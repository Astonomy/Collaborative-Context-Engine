import { expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import HomePage from "./page";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

it("opens the Vue product from the default browser entry", () => {
  HomePage();
  expect(redirect).toHaveBeenCalledWith("/vue/");
});
