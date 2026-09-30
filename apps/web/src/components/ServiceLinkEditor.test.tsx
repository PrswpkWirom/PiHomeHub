// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { ServiceLinkEditor } from "./ServiceLinkEditor";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("adds an aircon quick link and returns the persisted result", async () => {
  const saved = { id: 1, slug: "custom-aircon", name: "Aircon", url: "http://aircon.local:8080", description: null, url_override: true };
  const post = vi.spyOn(api, "post").mockResolvedValue(saved);
  const onSave = vi.fn();
  render(<ServiceLinkEditor link={null} onSave={onSave} onCancel={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Aircon" } });
  fireEvent.change(screen.getByLabelText(/Dashboard URL/), { target: { value: saved.url } });
  fireEvent.click(screen.getByRole("button", { name: "Save link" }));
  await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith(saved));
  expect(post).toHaveBeenCalledWith("/api/services/links", { name: "Aircon", url: saved.url, description: null });
});

it("shows the current URL and preserves the edit on a save failure", async () => {
  const link = { id: -1, slug: "vaultwarden", name: "Vaultwarden", url: "http://100.64.1.2:3004", description: null };
  const patch = vi.spyOn(api, "patch").mockRejectedValue(new Error("Could not save"));
  const onSave = vi.fn();
  render(<ServiceLinkEditor link={link} onSave={onSave} onCancel={vi.fn()} />);
  expect(screen.getByText(/Current link: http/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText(/Dashboard URL/), { target: { value: "https://vault.local" } });
  fireEvent.click(screen.getByRole("button", { name: "Save link" }));
  expect(await screen.findByText("Could not save")).toBeTruthy();
  expect(patch).toHaveBeenCalledWith("/api/services/links/vaultwarden", { name: "Vaultwarden", url: "https://vault.local", description: null });
  expect((screen.getByLabelText(/Dashboard URL/) as HTMLInputElement).value).toBe("https://vault.local");
  expect(onSave).not.toHaveBeenCalled();
});
