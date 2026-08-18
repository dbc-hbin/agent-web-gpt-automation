export interface OrchestrationConfig { kind: 'comprehensive' | 'multi'; lanes: number; runtime: 'common-run'; }
export const comprehensiveConfig = (lanes = 1): OrchestrationConfig => ({ kind: 'comprehensive', lanes, runtime: 'common-run' });
export const multiConfig = (lanes = 2): OrchestrationConfig => ({ kind: 'multi', lanes, runtime: 'common-run' });
