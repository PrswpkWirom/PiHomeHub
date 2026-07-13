// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PORT_POLL_INTERVAL_MS, PORT_POLL_TIMEOUT_MS, usePendingPortPolling } from "./usePendingPortPolling";

describe("usePendingPortPolling", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls pending ports every five seconds and stops after two minutes", async () => {
    vi.useFakeTimers();
    const poll = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePendingPortPolling(["adguard-home"], poll));

    await act(async () => vi.advanceTimersByTimeAsync(PORT_POLL_INTERVAL_MS));
    expect(poll).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(PORT_POLL_TIMEOUT_MS - PORT_POLL_INTERVAL_MS));
    expect(result.current.expiredSlugs.has("adguard-home")).toBe(true);
    const callsAtTimeout = poll.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(PORT_POLL_INTERVAL_MS * 2));
    expect(poll).toHaveBeenCalledTimes(callsAtTimeout);
  });

  it("does not overlap slow polls and exposes current failures", async () => {
    vi.useFakeTimers();
    let rejectPoll: ((reason: Error) => void) | undefined;
    const poll = vi.fn(() => new Promise((_resolve, reject) => { rejectPoll = reject; }));
    const { result } = renderHook(() => usePendingPortPolling(["adguard-home"], poll));

    await act(async () => vi.advanceTimersByTimeAsync(PORT_POLL_INTERVAL_MS * 2));
    expect(poll).toHaveBeenCalledOnce();
    await act(async () => rejectPoll?.(new Error("Control agent unavailable")));
    expect(result.current.error).toBe("Control agent unavailable");
  });

  it("stops polling immediately when the pending service resolves", async () => {
    vi.useFakeTimers();
    const poll = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ pending }) => usePendingPortPolling(pending, poll),
      { initialProps: { pending: ["adguard-home"] as string[] } }
    );
    await act(async () => vi.advanceTimersByTimeAsync(PORT_POLL_INTERVAL_MS));
    rerender({ pending: [] });
    const callsAfterResolution = poll.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(PORT_POLL_INTERVAL_MS * 2));
    expect(poll).toHaveBeenCalledTimes(callsAfterResolution);
  });
});
