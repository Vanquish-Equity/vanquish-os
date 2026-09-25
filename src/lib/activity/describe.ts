export type DescribableActivity = {
  event_type: string;
  payload: Record<string, unknown>;
};

export function describeActivity(eventType: string, payload: Record<string, unknown>) {
  if (eventType === "COMPANY_UPDATED" && typeof payload.field === "string") {
    return `Company updated: ${payload.field}`;
  }
  if (eventType === "DEAL_FIELD_CHANGED" && typeof payload.field === "string") {
    return `Deal field changed: ${payload.field}`;
  }
  if (eventType === "DEAL_OUTCOME_CHANGED") return "Deal outcome changed";
  if (eventType === "DOCUMENT_UPLOADED") return "Document added";
  if (eventType === "DOCUMENT_ARCHIVED") return "Document archived";
  if (eventType === "TASK_CREATED") return "Task created";
  if (eventType === "TASK_UPDATED") return "Task updated";
  if (eventType === "DEAL_ARCHIVED") {
    return payload.reason === "manual" ? "Deal archived" : "Duplicate deal archived";
  }
  if (eventType === "DEAL_RESTORED") return "Deal restored";
  if (eventType === "DEAL_CREATED") return "Deal created";
  if (eventType === "TASK_COMPLETED") return "Task completed";
  if (eventType === "TASK_REOPENED") return "Task reopened";
  if (eventType === "TASK_ARCHIVED") return "Task archived";
  if (eventType === "REQUIREMENT_STATUS_CHANGED") return "Requirement updated";
  if (eventType === "INTERACTION_LOGGED") return "Interaction logged";
  if (eventType === "STATUS_CHANGED") return "Stage changed";
  return eventType.replaceAll("_", " ").toLowerCase();
}

export function describeActivityDetail(event: DescribableActivity) {
  const { payload } = event;
  if (typeof payload.title === "string") return payload.title;
  if (
    event.event_type === "TASK_UPDATED" &&
    typeof payload.after === "object" &&
    payload.after !== null &&
    "title" in payload.after
  ) {
    return String(payload.after.title);
  }
  if (typeof payload.name === "string") return payload.name;
  if (typeof payload.expectedLabel === "string") return payload.expectedLabel;
  return null;
}
