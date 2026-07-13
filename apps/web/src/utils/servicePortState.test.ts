import { describe, expect, it } from "vitest";

import type { ServicePortConfig } from "../types/api";
import { resolvedPortFeedback } from "./servicePortState";

const pending: ServicePortConfig = {
  slug: "adguard-home",
  name: "Adguard Home",
  status: "running",
  detail: "Running",
  deployment_mode: "operator",
  configuration_mode: "web",
  bindings_verified: true,
  operator_command: "docker compose --force-recreate adguard-home",
  has_pending_port_change: true,
  ports: [{
    key: "dns",
    label: "DNS",
    env_var: "ADGUARD_DNS_PORT",
    container_port: 53,
    protocols: ["tcp", "udp"],
    default_host_port: 53,
    desired_host_port: 53,
    running_host_ports: { tcp: 69, udp: 69 },
    pending: true
  }]
};

describe("resolvedPortFeedback", () => {
  it("returns contextual success only after authoritative resolution", () => {
    const resolved = {
      ...pending,
      has_pending_port_change: false,
      ports: pending.ports.map((port) => ({
        ...port,
        running_host_ports: { tcp: 53, udp: 53 },
        pending: false
      }))
    };
    expect(resolvedPortFeedback(pending, resolved)).toEqual({
      kind: "success",
      text: "Adguard Home: DNS port changed to TCP/UDP 53."
    });
    expect(resolvedPortFeedback(resolved, resolved)).toBeNull();
  });

  it("keeps a warning when ports changed but the service is unhealthy", () => {
    const stopped = {
      ...pending,
      status: "exited",
      has_pending_port_change: false,
      bindings_verified: true,
      ports: pending.ports.map((port) => ({
        ...port,
        running_host_ports: { tcp: 53, udp: 53 },
        pending: false
      }))
    };
    expect(resolvedPortFeedback(pending, stopped)).toMatchObject({ kind: "warning", persistent: true });
  });

  it("does not infer completion while bindings are unavailable", () => {
    const unavailable = { ...pending, status: "missing", has_pending_port_change: false, bindings_verified: false };
    expect(resolvedPortFeedback(pending, unavailable)).toBeNull();
  });

  it("uses the latest pending target and distinguishes cancellation", () => {
    const changedTarget = {
      ...pending,
      ports: pending.ports.map((port) => ({ ...port, desired_host_port: 54 }))
    };
    const applied = {
      ...changedTarget,
      has_pending_port_change: false,
      ports: changedTarget.ports.map((port) => ({
        ...port,
        running_host_ports: { tcp: 54, udp: 54 },
        pending: false
      }))
    };
    expect(resolvedPortFeedback(changedTarget, applied)?.text).toContain("TCP/UDP 54");

    const cancelled = {
      ...pending,
      has_pending_port_change: false,
      ports: pending.ports.map((port) => ({
        ...port,
        desired_host_port: 69,
        running_host_ports: { tcp: 69, udp: 69 },
        pending: false
      }))
    };
    expect(resolvedPortFeedback(pending, cancelled)?.text).toBe(
      "Adguard Home: pending port change cancelled; DNS remains TCP/UDP 69."
    );

    const retargetedBetweenPolls = {
      ...pending,
      has_pending_port_change: false,
      ports: pending.ports.map((port) => ({
        ...port,
        desired_host_port: 54,
        running_host_ports: { tcp: 54, udp: 54 },
        pending: false
      }))
    };
    expect(resolvedPortFeedback(pending, retargetedBetweenPolls)?.text).toBe(
      "Adguard Home: DNS port changed to TCP/UDP 54."
    );
  });
});
