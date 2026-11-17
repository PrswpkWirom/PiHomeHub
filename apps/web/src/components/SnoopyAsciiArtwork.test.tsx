// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const renderer = vi.hoisted(() => ({ mount: vi.fn() }));
vi.mock("./snoopy-ascii-animation.js", () => ({ mountSnoopyAsciiAnimation: renderer.mount }));
import { SnoopyAsciiArtwork } from "./SnoopyAsciiArtwork";

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function mockPlayback() {
  const playback = { play: vi.fn(), pause: vi.fn(), destroy: vi.fn() };
  renderer.mount.mockReturnValue(playback);
  return playback;
}

describe("Snoopy ASCII artwork", () => {
  it("mounts the decorative canvas without a caption or playback control", () => {
    const playback = mockPlayback();
    const view = render(<SnoopyAsciiArtwork />);
    expect(renderer.mount.mock.calls[0][0]).toBeInstanceOf(HTMLCanvasElement);
    expect(screen.queryByRole("button")).toBeNull();
    expect(view.container.querySelector("figcaption")).toBeNull();
    expect(view.container.textContent).toBe("");
    expect(renderer.mount).toHaveBeenCalledOnce();
    view.unmount();
    expect(playback.destroy).toHaveBeenCalledOnce();
  });

  it("does not restart or override the renderer on rerender", () => {
    const playback = mockPlayback();
    const view = render(<SnoopyAsciiArtwork />);
    view.rerender(<SnoopyAsciiArtwork />);
    expect(renderer.mount).toHaveBeenCalledOnce();
    expect(playback.play).not.toHaveBeenCalled();
    expect(playback.pause).not.toHaveBeenCalled();
  });

  it("cleans up the development StrictMode remount and final unmount", () => {
    const playback = mockPlayback();
    const view = render(<StrictMode><SnoopyAsciiArtwork /></StrictMode>);
    expect(renderer.mount).toHaveBeenCalledTimes(2);
    expect(playback.destroy).toHaveBeenCalledOnce();
    view.unmount();
    expect(playback.destroy).toHaveBeenCalledTimes(2);
  });
});
