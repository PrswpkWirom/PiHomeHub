// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { ConfirmDialog } from "./ConfirmDialog";

function DialogHarness({ disableTriggerAfterConfirm = false }: { disableTriggerAfterConfirm?: boolean }) {
  const [open, setOpen] = useState(false);
  const [disabled, setDisabled] = useState(false);
  return <div id="root">
    <button type="button" disabled={disabled} onClick={() => setOpen(true)}>Open confirmation</button>
    <main id="main-content" data-dialog-focus-fallback tabIndex={-1}>
      <p>Page content</p>
    </main>
    {open ? <ConfirmDialog
      title="Delete device?"
      description="This action removes the device."
      confirmLabel="Delete"
      onCancel={() => setOpen(false)}
      onConfirm={() => { setOpen(false); if (disableTriggerAfterConfirm) setDisabled(true); }}
    /> : null}
  </div>;
}

describe("ConfirmDialog", () => {
  afterEach(() => cleanup());

  it("traps keyboard focus, makes the background inert, and restores focus on cancel", () => {
    render(<DialogHarness />);
    const trigger = screen.getByRole("button", { name: "Open confirmation" });
    trigger.focus();
    fireEvent.click(trigger);
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Delete" });

    expect(document.getElementById("root")?.hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);
    fireEvent.click(cancel);

    expect(document.getElementById("root")?.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("uses the main content as a focus fallback if the trigger becomes disabled", () => {
    render(<DialogHarness disableTriggerAfterConfirm />);
    const trigger = screen.getByRole("button", { name: "Open confirmation" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(document.activeElement).toBe(document.getElementById("main-content"));
  });
});
