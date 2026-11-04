# AI Asset Studio

준비 상태별 짧은 입력 → GPT 기획 대화와 초안 확정 → 이미지 제작·수정·버전 선택 → 에셋 확정 → 폴더별 ZIP 다운로드.

## 구조

- public/: 기존 홈페이지와 JavaScript 작업실
- app/: Vinext 라우트, 인증된 API 진입점
- lib/studio-api.mjs: 소유자 검사, D1 원자적 작업 등록·예산 예약, OpenAI Responses 비동기 작업, R2 이미지 저장
- lib/studio-domain.mjs: 기획 계약·검증·가격 계산
- lib/studio-export.mjs: 확정 버전·참조 검증, 오프라인 패키지 문서
- public/studio/zip.mjs: UTF-8 ZIP 작성과 CRC32
- db/schema.ts, drizzle/: D1 스키마와 버전별 마이그레이션

## 개발

Node 22.13 이상. npm ci 후 npm run db:generate(스키마 변경 시), npm run build.
로컬 DB에 아직 적용하지 않은 마이그레이션만 차례대로 적용한다:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_awesome_gladiator.sql
npm run dev -- --host 127.0.0.1 --port 4173
```

로컬 미리보기에서는 /signin-with-chatgpt?return_to=/studio/ 에서 테스트 로그인한다. 이 로그인은 공식 starter의 loopback 전용 mock 인증이며 배포에는 포함되지 않는다.

서버의 OPENAI_API_KEY는 Sites의 비밀 환경 변수로 설정한다. 키를 hosting.json, 브라우저, Git에 넣지 않는다. 로컬 키 파일의 승인과 호스팅 서버로 전송하는 승인은 별개다.

## 검증

```sh
npm test
npm run build
```

일반 검증은 실제 SQLite와 모의 OpenAI/R2를 사용해 인증·소유권·단계 승인·중복 요청·예산·참조 변경·이미지 수정·ZIP을 확인한다. 테스트 PNG는 검증용이며 제품에서 실제 AI 결과로 표시하지 않는다.

2026-11-04: 실제 gpt-6-luna 기획 호출에서 60초/6쇼트의 구조화된 초안 및 합계 검증 통과. 이미지 모델의 실제 유료 생성·편집은 아직 검증하지 않았다. 배포 서버의 API 키 등록은 별도 승인 대기다.

## 2026-11-04 검토 반영

- 기획 스키마에 모델용 영어 필드를 추가했다: 작품 `stylePrompt`, 인물·장소·소품 `visualPrompt`, 쇼트 `motion`. 한국어 필드는 사용자용, 영어 필드는 이미지·영상 모델용으로 분리한다. 예전 초안은 빈 값으로 통과하고 한국어 설명으로 대체한다.
- GPT 지시문에 외형 규격(나이대·체형·머리·의상 색·소지품 등)과 쇼트 prompt/motion 작성 규칙, 바뀐 항목(`changes`) 보고 규칙을 넣었다.
- 중간 턴의 초안 검증 오류는 턴을 실패시키지 않고 `draftWarning`으로 보여 준다. 확정(confirm-plan)에서만 차단한다.
- 기준 이미지 프롬프트에 구도를 고정했다(전신 정면·단색 배경 / 와이드 설정 샷 / 소품 단독). 장면 프롬프트는 참조 이미지를 첨부 순서대로 번호와 이름으로 지정한다. 캐릭터·소품 기준 이미지는 1024x1024로 만든다.
- 이미지 수정은 짧은 편집 지시만 보내고 바꿀 내용을 필수로 받는다. 이미지 도구 호출에 프롬프트를 그대로 넘기라는 developer 지시를 붙이고, 응답의 `revised_prompt`를 `studio_versions.revised_prompt`에 저장한다(마이그레이션 `0001_revised_prompt`).
- 새 서버 동작: `edit-draft`(확정 전 초안 직접 수정), `edit-prompt`(에셋 프롬프트 수정), `exclude`(에셋 제외·포함). 제외한 에셋은 생성·확정·ZIP에서 빠지고, 장면이 참조하는 기준 에셋은 장면을 먼저 제외해야 뺄 수 있다.
- ZIP의 영상 프롬프트에 STYLE/FRAME/MOTION/CAMERA와 등장 인물·장소의 외형 프롬프트를 담는다.
- 작업실: 초안 직접 수정 폼, 바뀐 내용 표시, 에셋별 프롬프트 보기·수정, 버전 나란히 비교, 에셋 제외, "아직 없는 이미지 N장 차례로 만들기"(브라우저가 순서를 들고 한 장씩 요청, 화면을 닫으면 남은 순서만 멈춤), 이미지 확대 시 요청·전달 프롬프트 표시, 넓은 화면에서 대화 옆 초안.

## 운영 범위

- gpt-6-luna: reasoning none, 구조화된 JSON, 최대 출력 6,000토큰.
- gpt-image-2.5-sunburst: Responses 이미지 도구, medium PNG, 요청당 한 장, 참조 최대 3장.
- 프로젝트당 최대 24개 에셋, 이미지당 최대 4MiB. 생성 실패에도 이전 버전을 보존한다.
- 프로젝트 예산 기본 $20, 계정의 앱 내 월 예산 $200(Asia/Seoul). 이미지당 $1 예약은 보수적인 추정이며 비용 상한을 보장하지 않는다.
- 현재 공식 가격으로 계산한 사용량 추정과 미확정 예약을 합산한다. 사용량이 없거나 응답 접수가 불명확하면 예약을 유지한다. 이전 달 미정산 비용도 새 달에 차감한다. 예약 초과가 발견되면 새 유료 요청을 중단한다.
- background=true, store=true로 응답 ID를 저장하고 재접속 시 이어서 조회한다. OpenAI에 표준 보존 기간(최소 30일)이 적용될 수 있다. 응답 만료·네트워크 유실은 자동 유료 재요청하지 않는다.
- ZIP은 서버에서 확정 버전 목록·해시를 고정한 뒤 브라우저가 파일을 검증해서 만든다. PNG는 이미 압축되어 있어 ZIP store 방식으로 묶는다. 오프라인 storyboard.html은 ZIP 내부 이미지만 참조한다.
- 앱 외부의 API 비용·세금·가격 변동은 이 앱이 통제할 수 없다. 비용 기록은 제공자의 최종 청구서가 아니다.
- 기존 브라우저 기획은 사용자가 '가져오기'로 서버에 이관한다. 원래 localStorage 백업은 삭제하지 않는다.
- 과거 기획 스냅샷·에셋·내보내기 기록은 DB에 보존한다. 이전 기획 복원 UI와 서버 ZIP 재다운로드 목록은 후속 범위다.

공식 근거: [모델](https://developers.openai.com/api/docs/models/gpt-6-luna), [이미지 모델](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst), [이미지 도구](https://developers.openai.com/api/docs/guides/tools-image-generation), [Background](https://developers.openai.com/api/docs/guides/background), [보존 정책](https://developers.openai.com/api/docs/guides/your-data).
