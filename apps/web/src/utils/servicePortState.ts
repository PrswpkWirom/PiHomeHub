import type { Feedback } from "../components/FeedbackMessage";
import type { ServicePortConfig } from "../types/api";

function formatProtocols(protocols: string[]) {
  return protocols.map((protocol) => protocol.toUpperCase()).join("/");
}

export function resolvedPortFeedback(before: ServicePortConfig | undefined, after: ServicePortConfig): Feedback | null {
  if (!before?.has_pending_port_change || after.has_pending_port_change || !after.bindings_verified) {
    return null;
  }
  const bindingsMatchDesired = after.ports.every((port) =>
    port.protocols.every((protocol) => port.running_host_ports[protocol] === port.desired_host_port)
  );
  if (!bindingsMatchDesired) {
    return null;
  }
  const afterByKey = new Map(after.ports.map((port) => [port.key, port]));
  const desiredChanged = before.ports.some((port) =>
    port.pending && afterByKey.get(port.key)?.desired_host_port !== port.desired_host_port
  );
  const bindingsUnchanged = before.ports
    .filter((port) => port.pending)
    .every((port) => port.protocols.every(
      (protocol) => afterByKey.get(port.key)?.running_host_ports[protocol] === port.running_host_ports[protocol]
    ));
  if (desiredChanged && bindingsUnchanged) {
    const reconciled = after.ports
      .filter((port) => before.ports.some((previous) => previous.key === port.key && previous.pending))
      .map((port) => `${port.label} remains ${formatProtocols(port.protocols)} ${port.desired_host_port}`)
      .join(", ");
    return { kind: "success", text: `${after.name}: pending port change cancelled; ${reconciled}.` };
  }
  const affectedKeys = new Set(before.ports.filter((port) => port.pending).map((port) => port.key));
  const completed = after.ports
    .filter((port) => affectedKeys.has(port.key))
    .map((port) => `${port.label} port changed to ${formatProtocols(port.protocols)} ${port.desired_host_port}`)
    .join(", ");
  if (after.status !== "running") {
    return {
      kind: "warning",
      persistent: true,
      text: `${after.name} port changes were applied, but the service is not running. Check the service status.`
    };
  }
  return { kind: "success", text: `${after.name}: ${completed}.` };
}
