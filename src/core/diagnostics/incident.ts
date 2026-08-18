export interface IncidentEvidence { code: string; message: string; details?: unknown }
export function diagnoseIncident(evidence: IncidentEvidence[]) { return { schema: 'codex.chatgpt.incident/v1', status: evidence.length ? 'ATTENTION_REQUIRED' : 'HEALTHY', evidence }; }
