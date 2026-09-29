// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { invalidateCache, useFetch } from "./useFetch";

function Probe() {
  const result = useFetch<{ value: string }>("/api/security/sessions");
  return <p>{result.data?.value ?? (result.loading ? "Loading" : "Empty")}</p>;
}

describe("useFetch cache invalidation", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("does not let a response started before invalidation replace fresh session data", async () => {
    let resolveOld!: (response: Response) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: "Current session confirmed" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }));
    vi.stubGlobal("fetch", fetchMock);

    render(<Probe />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    act(() => invalidateCache("/api/security/sessions"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Current session confirmed")).toBeTruthy();

    await act(async () => {
      resolveOld(new Response(JSON.stringify({ value: "Old session" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.getByText("Current session confirmed")).toBeTruthy();
    expect(screen.queryByText("Old session")).toBeNull();
  });
});
