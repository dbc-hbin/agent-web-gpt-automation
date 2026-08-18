 # 전역 ChatGPT 라우팅 가이드 (Global ChatGPT Routing)

 이 문서는 로컬 에이전트 환경에서 웹 ChatGPT 세션으로 작업을 위임할 때의 모드별 실행 경로와 라우팅 규칙을 설명합니다.

 ## 지원 모드 및 실행 경로

 | 모드 | 목적 | 실행 경로 | 권한 및 특징 |
 |---|---|---|---|
 | `direct` | 질문, 단일 분석, 가벼운 작업 | Oracle + DevSpace | 기본 비-Pro 최고 추론 강도 |
 | `plan` | 구현 전 아키텍처/설계 | Oracle (읽기 전용) | DevSpace 파일 읽기 전용 |
 | `review` | 코드 및 계획 독립 검토 | Oracle (읽기 전용) | 변경 사항 비파괴 검토 |
 | `edit` | 범위가 한정된 구현 및 테스트 | Oracle + DevSpace | exact root 내 파일 수정 및 테스트 실행 |
 | `orchestrator` | 단일 세션 완결형 실행 | Oracle + DevSpace | 전체 워크플로 완결 |
 | `deep-research` | 공개 자료 심층 리서치 | Oracle Deep Research | DevSpace 없이 미션/자료 직접 첨부 |
 | `ultra-economy` | 로컬 모델 비용 최소화 | Luna Max 지휘 + 웹 세션 | 로컬 소형 모델 + 웹 집중 실행 |
 | `pro` | 고난도 설계 및 종합 작업 | GPT-5.6 Sol Pro + DevSpace | 사용자 명시 요청 시에만 활성화 (쿼터 보호) |

 ## 라우팅 핵심 규칙

 1. **기본 모델 및 추론 강도**: 일반 웹 작업은 `gpt-5.6`에 비-Pro 최고 추론 강도(`extra-high`)를 기본으로 사용합니다.
 2. **Pro 자동 승격 금지**: Pro 모델은 사용 쿼터가 제한적이므로 사용자의 명시적 요청이 있을 때만 선택하며 자동으로 승격하지 않습니다.
 3. **Exact Root 바인딩**: 모든 DevSpace 세션은 사전에 승인된 정확한 프로젝트 루트에만 바인딩됩니다.

