// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LoginPanel } from "./login-panel";

describe("LoginPanel", () => {
  it("keeps submission disabled until a token meets the transport minimum", async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn<(apiToken: string) => Promise<void>>().mockResolvedValue();
    render(<LoginPanel busy={false} error={null} onLogin={onLogin} />);

    const submit = screen.getByRole("button", { name: "Continue securely" });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText("API token"), "x".repeat(24));
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(onLogin).toHaveBeenCalledWith("x".repeat(24));
  });

  it("announces authentication failures", () => {
    render(
      <LoginPanel busy={false} error="Invalid API token." onLogin={() => Promise.resolve()} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid API token.");
  });
});
