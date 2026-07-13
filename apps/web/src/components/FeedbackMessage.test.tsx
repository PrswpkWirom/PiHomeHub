// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FeedbackMessage } from "./FeedbackMessage";

describe("FeedbackMessage", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("announces errors immediately and successes politely", () => {
    const { rerender } = render(<FeedbackMessage feedback={{ kind: "error", text: "Save failed." }} />);
    expect(screen.getByRole("alert").textContent).toContain("Save failed.");

    rerender(<FeedbackMessage feedback={{ kind: "success", text: "AdGuard Home DNS port changed to 53." }} />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toContain("AdGuard Home DNS port changed to 53.");
  });

  it("keeps layout classes on the collapsible message container", () => {
    vi.useFakeTimers();
    render(
      <FeedbackMessage
        className="col-span-full mt-4"
        feedback={{ kind: "success", text: "Saved." }}
        onDismiss={() => undefined}
      />
    );

    const container = screen.getByRole("status").closest<HTMLElement>("[data-feedback-state]");
    expect(container?.className).toContain("col-span-full");
    expect(container?.className).toContain("mt-4");

    act(() => vi.advanceTimersByTime(4_500));
    expect(container?.style.marginBlock).toBe("0");
  });

  it("starts closing a transient success at 4.5 seconds and dismisses it at 5 seconds", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    render(<FeedbackMessage feedback={{ kind: "success", text: "Saved." }} onDismiss={dismiss} />);

    const message = screen.getByRole("status");
    expect(message.closest("[data-feedback-state]")?.getAttribute("data-feedback-state")).toBe("visible");

    act(() => vi.advanceTimersByTime(4_499));
    expect(dismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(message.closest("[data-feedback-state]")?.getAttribute("data-feedback-state")).toBe("exiting");
    expect(dismiss).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(499));
    expect(dismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it("dismisses a transient action error after five seconds", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    render(<FeedbackMessage feedback={{ kind: "error", text: "Restart failed." }} onDismiss={dismiss} />);

    act(() => vi.advanceTimersByTime(5_000));

    expect(dismiss).toHaveBeenCalledOnce();
  });

  it("keeps reduced-motion feedback still until its five-second dismissal", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    render(<FeedbackMessage feedback={{ kind: "success", text: "Saved." }} onDismiss={dismiss} />);

    const message = screen.getByRole("status");
    act(() => vi.advanceTimersByTime(4_999));

    expect(message.closest("[data-feedback-state]")?.getAttribute("data-feedback-state")).toBe("visible");
    expect(dismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it("restarts the lifetime when transient feedback is replaced", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    const { rerender } = render(
      <FeedbackMessage feedback={{ kind: "success", text: "First save completed." }} onDismiss={dismiss} />
    );

    act(() => vi.advanceTimersByTime(4_000));
    rerender(<FeedbackMessage feedback={{ kind: "success", text: "Second save completed." }} onDismiss={dismiss} />);
    act(() => vi.advanceTimersByTime(1_000));
    expect(dismiss).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(4_000));
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it("is removed from the page when its five-second lifetime ends", () => {
    vi.useFakeTimers();

    function DismissibleFeedback() {
      const [visible, setVisible] = useState(true);
      return visible
        ? <FeedbackMessage feedback={{ kind: "success", text: "Saved." }} onDismiss={() => setVisible(false)} />
        : null;
    }

    render(<DismissibleFeedback />);
    act(() => vi.advanceTimersByTime(4_999));
    expect(screen.queryByText("Saved.")).toBeTruthy();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText("Saved.")).toBeNull();
  });

  it("keeps success visible when a follow-up action is required", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    render(
      <FeedbackMessage
        feedback={{ kind: "success", persistent: true, text: "Ports saved. Redeployment is required." }}
        onDismiss={dismiss}
      />
    );

    act(() => vi.advanceTimersByTime(20_000));
    expect(dismiss).not.toHaveBeenCalled();
  });

  it.each([
    { kind: "progress" as const, text: "Checking deployment status." },
    { kind: "warning" as const, text: "Redeployment is required." },
    { kind: "error" as const, persistent: true, text: "Service status is unavailable." }
  ])("keeps $kind feedback visible while its state still applies", (feedback) => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    render(<FeedbackMessage feedback={feedback} onDismiss={dismiss} />);

    act(() => vi.advanceTimersByTime(20_000));

    expect(dismiss).not.toHaveBeenCalled();
    expect(screen.getByText(feedback.text)).toBeTruthy();
  });
});
