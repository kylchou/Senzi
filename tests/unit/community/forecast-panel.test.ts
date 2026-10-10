// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createElement, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ForecastPanel } from "@/components/ForecastPanel";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
// Clerk's modal is out of scope here; render the trigger as-is.
// Signed in unless a test says otherwise; the API still decides (401 means the session expired).
const auth = vi.hoisted(() => ({ isLoaded: true, isSignedIn: true }));
vi.mock("@clerk/nextjs", () => ({ SignInButton: ({ children }: { children: ReactNode }) => children, useAuth: () => auth }));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function mockApi({ balance, submit }: { balance: Handler; submit?: Handler }) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "/api/users/me") return balance(url, init);
    if (url === "/api/forecasts" && submit) return submit(url, init);
    throw new Error(`Unexpected fetch ${url}`);
  });
}

const me = (creditBalance: number, accountType: "VC" | "TRADER" | null = "TRADER") => json(200, { data: { creditBalance, accountType } });
const fail = (status: number, code: string) => json(status, { error: { code, message: code } });
const renderPanel = (isOpen = true) => render(createElement(ForecastPanel, { marketId: "m1", isOpen }));

const receipt = {
  id: "rcpt_123",
  marketId: "m1",
  side: "NO",
  credits: 50,
  createdAt: "2026-10-09T12:00:00Z",
  entryAllocationShare: 0.62,
  balanceAfter: 950,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  refresh.mockReset();
});

describe("ForecastPanel", () => {
  it("shows a closed state without calling the API", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    renderPanel(false);
    expect(screen.getByText(/closed to new forecasts/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks signed-out users to sign in", async () => {
    mockApi({ balance: () => fail(401, "UNAUTHENTICATED") });
    renderPanel();
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("tells VC accounts they can't trade instead of showing the form", async () => {
    mockApi({ balance: () => me(1000, "VC") });
    renderPanel();
    expect(await screen.findByText(/VC accounts can.t trade/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Place forecast/i })).not.toBeInTheDocument();
  });

  it("sends accounts without a type to finish setup", async () => {
    mockApi({ balance: () => me(1000, null) });
    renderPanel();
    expect(await screen.findByRole("link", { name: "Finish setup" })).toHaveAttribute("href", "/onboarding");
  });

  it("skips the API when Clerk already knows the visitor is signed out", async () => {
    const balance = vi.fn<Handler>(() => me(1000));
    mockApi({ balance });
    auth.isSignedIn = false;
    try {
      renderPanel();
      expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
      expect(balance).not.toHaveBeenCalled();
    } finally {
      auth.isSignedIn = true;
    }
  });

  it("submits a forecast and shows the server receipt", async () => {
    const user = userEvent.setup();
    const submit = vi.fn<Handler>(() => json(201, { data: receipt }));
    mockApi({ balance: () => me(1000), submit });
    renderPanel();

    expect(await screen.findByText("1,000 available")).toBeInTheDocument();
    await user.click(screen.getByLabelText("NO"));
    await user.click(screen.getByRole("button", { name: "50" }));
    await user.click(screen.getByRole("button", { name: "Forecast NO" }));

    expect(await screen.findByText("Forecast recorded")).toBeInTheDocument();
    expect(screen.getByText("950 credits")).toBeInTheDocument();
    expect(screen.getByText("62%")).toBeInTheDocument();
    expect(screen.getByText("Receipt rcpt_123")).toBeInTheDocument();

    const body = JSON.parse(submit.mock.calls[0][1]?.body as string);
    expect(body).toMatchObject({ marketId: "m1", side: "NO", credits: 50 });
    expect(body.idempotencyKey).toEqual(expect.any(String));
    expect(refresh).toHaveBeenCalled();
  });

  it("blocks allocations above the server balance before sending", async () => {
    const user = userEvent.setup();
    const submit = vi.fn<Handler>();
    mockApi({ balance: () => me(20), submit });
    renderPanel();

    const input = await screen.findByLabelText("Allocation");
    await user.clear(input);
    await user.type(input, "30");
    await user.click(screen.getByRole("button", { name: "Forecast YES" }));

    expect(screen.getByText("Not enough credits for this allocation.")).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it("shows server errors for insufficient credits", async () => {
    const user = userEvent.setup();
    mockApi({ balance: () => me(1000), submit: () => fail(409, "INSUFFICIENT_CREDITS") });
    renderPanel();
    await screen.findByText("1,000 available");
    await user.click(screen.getByRole("button", { name: "Forecast YES" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not enough credits for this allocation.");
  });

  it("switches to the sign-in prompt when the session expires", async () => {
    const user = userEvent.setup();
    mockApi({ balance: () => me(1000), submit: () => fail(401, "UNAUTHENTICATED") });
    renderPanel();
    await screen.findByText("1,000 available");
    await user.click(screen.getByRole("button", { name: "Forecast YES" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/session expired/i);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("locks the form when the server reports the market closed", async () => {
    const user = userEvent.setup();
    mockApi({ balance: () => me(1000), submit: () => fail(409, "INVALID_STATE") });
    renderPanel();
    await screen.findByText("1,000 available");
    await user.click(screen.getByRole("button", { name: "Forecast YES" }));
    expect(await screen.findByText(/closed to new forecasts/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Forecast (YES|NO)$/ })).not.toBeInTheDocument();
  });

  it("reuses the idempotency key when retrying after a network error", async () => {
    const user = userEvent.setup();
    const submit = vi
      .fn<Handler>()
      .mockImplementationOnce(() => {
        throw new TypeError("Failed to fetch");
      })
      .mockImplementationOnce(() => json(201, { data: { ...receipt, side: "YES", credits: 25 } }));
    mockApi({ balance: () => me(1000), submit });
    renderPanel();
    await screen.findByText("1,000 available");

    await user.click(screen.getByRole("button", { name: "Forecast YES" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/connection lost/i);
    await user.click(screen.getByRole("button", { name: "Forecast YES" }));
    await screen.findByText("Forecast recorded");

    const keys = submit.mock.calls.map(([, init]) => JSON.parse(init?.body as string).idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
  });

  it("uses a new idempotency key when the forecast changes", async () => {
    const user = userEvent.setup();
    const submit = vi.fn<Handler>(() => fail(409, "INSUFFICIENT_CREDITS"));
    mockApi({ balance: () => me(1000), submit });
    renderPanel();
    await screen.findByText("1,000 available");

    await user.click(screen.getByRole("button", { name: "Forecast YES" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "10" }));
    await user.click(screen.getByRole("button", { name: "Forecast YES" }));

    const keys = submit.mock.calls.map(([, init]) => JSON.parse(init?.body as string).idempotencyKey);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("falls back gracefully when the balance cannot load", async () => {
    mockApi({ balance: () => fail(500, "INTERNAL_ERROR") });
    renderPanel();
    expect(await screen.findByText("Balance unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Forecast YES" })).toBeEnabled();
  });
});
