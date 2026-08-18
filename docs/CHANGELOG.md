# 기술 변경 기록

## 1.0.0 - Agent Web GPT Automation 공개 릴리스

- 포크 공개 이름과 package metadata를 `Agent Web GPT Automation` /
  `agent-web-gpt-automation`으로 일반화했습니다. Oracle dispatch·DevSpace 경로는
  다른 에이전트도 사용할 수 있으며, lifecycle·상태 경로·기능 gate는
  `AGENT_WEB_GPT_*` 계약을 우선합니다.
- portability CI의 `workflow_dispatch` 진입점을 제공합니다.
- Oracle 0.17.1 호환성 검사와 검증된 패치·버전의 fail-closed 보호를 제공합니다.
- Windows와 macOS에서 DevSpace·Tailscale Funnel 복구를 지원하며, 플랫폼별
  실행 경로(Windows Git Bash, macOS native npx)를 유지합니다.
- ChatGPT Extra High UI의 검증된 4단계·5단계 스케일을 지원하며, 표시된 exact
  scale을 제출 전에 증명합니다.
- 설치 전 백업·durable 영수증·portability/fast-gate/golden-path 계약 검사를
  제공합니다.
