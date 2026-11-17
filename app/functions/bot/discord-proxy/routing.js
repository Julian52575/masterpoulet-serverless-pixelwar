const SNAPSHOT_REQUESTED = "snapshot.requested";

function toSnapshotRequest(command, requestedAt) {
  return {
    type: SNAPSHOT_REQUESTED,
    snapshot_id: command.interaction_id ?? command.correlation_id,
    requested_at: requestedAt.toISOString(),
    requested_by: command.user_id,
    application_id: command.application_id,
    interaction_token: command.interaction_token,
    channel_id: command.channel_id ?? null,
    correlation_id: command.correlation_id
  };
}

function routeCommand(command, now = new Date()) {
  if (command.type === "draw") {
    return { route: "draw", event: command, attributes: { type: command.type, correlation_id: command.correlation_id } };
  }

  if (command.type === "snapshot") {
    const event = toSnapshotRequest(command, now);
    return {
      route: "snapshot",
      event,
      attributes: { type: event.type, snapshot_id: String(event.snapshot_id), correlation_id: event.correlation_id }
    };
  }

  return { route: "commands", event: command, attributes: { type: command.type, correlation_id: command.correlation_id } };
}

module.exports = { routeCommand, SNAPSHOT_REQUESTED };
