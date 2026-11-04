# 홈페이지 작업 지침

- 상위 AGENTS.md와 AI_Asset_Studio.md를 따른다.
- UI는 public/의 HTML/CSS/JavaScript, 서버는 Vinext App Router와 Cloudflare Workers다. app/api/[...segments]/route.ts가 lib/studio-api.mjs로 연결된다.
- D1에는 프로젝트·작업·승인 스냅샷·에셋 버전·내보내기를, R2에는 PNG를 저장한다. db/schema.ts 수정 후 Drizzle 마이그레이션을 생성하고 검토한다. 적용된 마이그레이션은 수정하지 않는다.
- public/studio/model.js는 이전 v1/v2 기획 이관을 유지한다. 입력 모드, 제작 단계, 보관 여부를 구분하고 사용자 입력과 GPT 결과를 분리한다.
- 관련 파일만 탐색하고 최소 범위로 수정한다. 불필요한 의존성과 도구 호출을 피하며 정확성과 안전성을 우선한다.
- API 키를 서버 비밀 설정에만 사용한다. 소스·클라이언트·로그·ZIP에 넣지 않는다. .openai/hosting.json의 project_id를 보존한다.
- 기획·에셋 확정은 사용자가 수행한다. 후보는 불변 버전으로 저장한다. 참조 이미지가 바뀐 장면은 재제작 후 재확정하기 전 내보내지 않는다.
- 비용은 정수 micro-USD로 관리한다. 이미지 예약은 추정치이며 절대 상한이 아니다. 미확정 금액을 유지하고 중복 유료 요청을 자동 전송하지 않는다.
- 변경된 동작에 필요한 npm test, npm run build 및 브라우저 검증만 수행한다. 유료 이미지 호출은 별도의 확인된 테스트 예산이 있을 때만 한다.
- 결과는 구현·검증·남은 제약을 한국어로 간결하게 보고한다.
