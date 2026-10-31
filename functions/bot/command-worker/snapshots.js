const SNAPSHOT_REQUESTED = "snapshot.requested";

function createSnapshotRequests({ topic }) {
  async function request({
    snapshotId,
    requestedAt,
    requestedBy,
    applicationId,
    interactionToken,
    channelId,
    correlationId
  }) {
    const event = {
      type: SNAPSHOT_REQUESTED,
      snapshot_id: snapshotId,
      requested_at: requestedAt.toISOString(),
      requested_by: requestedBy,
      application_id: applicationId,
      interaction_token: interactionToken,
      channel_id: channelId ?? null,
      correlation_id: correlationId ?? null
    };

    return topic.publishMessage({
      json: event,
      attributes: {
        type: SNAPSHOT_REQUESTED,
        snapshot_id: String(snapshotId),
        correlation_id: correlationId ?? ""
      }
    });
  }

  return { request };
}

module.exports = { createSnapshotRequests, SNAPSHOT_REQUESTED };
