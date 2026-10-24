# SellReady

SellReady는 보유한 물건의 구매정보, 현재 가치, 상태를 기록하고 판매 준비까지 연결하는 웹서비스입니다.

## 현재 구현 범위

- 프로토타입 로그인 및 이메일별 브라우저 데이터 분리
- My Vault 제품 등록, 조회, 검색, 카테고리 필터, 수정, 삭제
- 구매일 기반 사용기간 계산
- 현재 신품가격 수동 기록 및 Price History
- 카테고리별 Condition Lab
- Sell Studio 사진 가이드와 이미지 업로드
- 판매 준비도와 판매글 초안 생성
- 판매글 복사
- Azure OpenAI 기반 판매글 생성 API (Microsoft 로그인한 모든 계정 사용 가능)
- 제품명 또는 동의한 사진으로 제품 식별 → 신품가 검색 → 구매일·사용감·하자 기반 중고 참고가격 자동 분석
- 선택 동의 시 제품 사진 최대 2장 외관 분석
- AI 웹 검색 기반 신품가격 후보·판매처 출처 조회 및 검색 후보 최저 표시가격 자동 적용
- Trust Sheet 공개 필드 선택 및 읽기 전용 공개 링크
- 업로드 이미지 기반 제품 카드와 Trust Sheet 미리보기

## 로컬 실행

```bash
npm install
npm run dev
```

## 배포 전 검증

```bash
npm run check
npm run preview
```

`npm run check`는 린트와 production 빌드를 순서대로 실행합니다.

## 현재 데이터 저장 방식

현재 앱은 프로토타입 단계로 `localStorage`에 데이터를 저장합니다. 물건 기록은 이메일을 정규화한 계정별 저장 키에 분리되며, 다른 이메일로 로그인하면 새 Vault가 열립니다. 같은 이메일로 다시 로그인하면 해당 브라우저에 저장한 기록을 불러옵니다. 이전 버전의 이메일별 저장 데이터도 같은 이메일에 한해 이어받지만, 공용 저장 키나 샘플 제품은 어떤 계정에도 불러오지 않습니다.

이 분리는 화면 동작을 위한 클라이언트 측 구분일 뿐 인증이나 보안 경계가 아닙니다. 저장소를 직접 열 수 있는 사람은 데이터를 볼 수 있고, 브라우저를 바꾸거나 저장공간을 지우면 기록이 사라질 수 있습니다. 실제 사용자의 개인정보 보호를 보장하지 않으므로 상용 서비스에서는 서버 인증과 데이터베이스 권한 검증이 필요합니다.

## Azure OpenAI 환경변수

Azure OpenAI의 endpoint, key, deployment name은 서버에서만 사용합니다. Sell Studio의 **AI로 판매글 생성** 버튼은 Azure Static Web Apps 관리형 Functions의 `/api/generate-listing`을 호출합니다. 이 API는 Azure Static Web Apps의 `authenticated` 역할로 보호되므로, AI 생성 전에 **Microsoft 계정으로 로그인**해야 합니다. 현재 앱의 이름·이메일 입력은 로컬 Vault용 프로토타입 로그인이며 Azure API 인증을 대신하지 않습니다.

### Azure CLI로 처음 설정 또는 키 교체

1. 프로젝트 루트의 `.env`에 `AZURE_OPENAI_ENDPOINT`와 `AZURE_OPENAI_DEPLOYMENT`를 입력합니다. Responses v1 endpoint는 받은 주소를 그대로 입력합니다. API key는 직접 복사하지 않아도 됩니다.
2. Azure CLI 로그인과 구독을 확인합니다.
3. PowerShell에서 다음 명령을 실행합니다.

```powershell
az login
az account set --subscription <구독 이름 또는 ID>
.\scripts\configure-azure-openai.ps1
```

스크립트는 `.env`의 endpoint와 일치하는 Azure AI 리소스를 찾아 Key1과 Key2를 모두 재발급합니다. 새 Key1을 로컬 `.env`와 Azure Static Web Apps의 Production API 설정에 저장합니다. API 키 값은 화면에 출력하지 않습니다. `.env`는 Git에서 제외되어 있으므로 키를 채팅이나 저장소에 올리지 마세요.

- `AZURE_OPENAI_ENDPOINT`: Azure OpenAI 리소스 Endpoint
- `AZURE_OPENAI_API_KEY`: API 키 (CLI 설정 스크립트가 재발급된 Key1을 저장)
- `AZURE_OPENAI_DEPLOYMENT`: Azure AI Foundry/Portal에 표시되는 모델 배포 이름
- `AZURE_OPENAI_API_VERSION`: 백엔드 SDK/API가 명시적으로 요구할 때만 설정

`.env`와 `.env.*`는 Git에서 제외됩니다. 실제 키를 채팅, 소스 코드, `VITE_*` 변수, 브라우저 코드 또는 GitHub 저장소에 넣지 마세요. Vite의 `VITE_*` 환경변수는 브라우저용 번들에 포함되어 사용자에게 노출됩니다.

CLI 스크립트가 세 변수를 Azure Static Web Apps의 서버 전용 Production API 설정에 적용합니다. 별도로 Portal에서 설정할 필요는 없습니다. 적용 후 Microsoft 계정(`/.auth/login/aad`)으로 로그인하고 Sell Studio에서 **AI로 판매글 생성**을 누릅니다. API는 로그인한 모든 계정을 허용하며 Functions 인스턴스별 사용자당 분당 5회 제한을 둡니다. 제한은 이메일 대신 인증된 사용자 ID로 구분하며, 비로그인 요청은 차단합니다. 기존 `AZURE_OPENAI_ALLOWED_EMAILS` 설정이 남아 있어도 더 이상 사용하지 않습니다. 이 요청 제한은 인스턴스 메모리 기반이므로 전역 사용량·비용 한도를 보장하지 않습니다.

로컬 Azure Functions API는 Node.js 22와 Azure Functions Core Tools v4가 필요합니다. 먼저 프로젝트 루트에서 프론트엔드 `npm run dev`를 실행하고, 별도 터미널에서 `npm start --prefix api`로 API를 실행합니다. API는 `.env`에서 같은 서버 환경변수를 읽습니다. Functions Core Tools가 없거나 `.env` 값이 비어 있으면 AI 버튼에서 오류 안내가 나오며, 기존 수동 판매글 편집 기능은 계속 사용할 수 있습니다.

AI 중고 가격은 실제 중고 거래 완료 데이터에 기반한 감정가가 아닙니다. 자동 분석 버튼에 동의하면 검색 신품가격과 구매일·경과기간·기록된 사용감·하자·구성품을 함께 참고해 범위를 제안합니다. 구매가는 보조 정보이며 필수가 아닙니다. 서버가 구매일로 경과기간을 계산하며 실제 사용시간으로 단정하지 않습니다. 신품가 근거가 없으면 중고 가격 제안은 보류하고 판매글만 생성합니다. 사진은 별도 동의한 경우 최대 2장만 식별·외관 분석에 사용하며 기능·배터리·정품 여부를 판정하지 않습니다.

### AI 신품가격 검색

Sell Studio에서 **동의하고 자동 가격 분석·판매글 생성**을 누르면 세 단계를 연속 수행합니다. 모델명이나 신품가 직접 입력, 판매처 수동 선택은 필수가 아닙니다.

1. `/api/identify-product`: 제품명 또는 동의한 사진으로 제품·모델을 식별합니다. 모호한 이름·사진에서는 임의의 모델을 만들지 않고 구체적 정보나 라벨 사진을 요청합니다.
2. `/api/search-new-price`: 식별된 제품으로 기존 Azure OpenAI Responses v1의 `web_search`를 사용합니다. 인용 근거가 있는 KRW 신품 후보 중 최저 표시가격을 자동 기준으로 사용합니다.
3. `/api/generate-listing`: 구매일·서버 계산 경과기간·사용감·하자·구성품과 신품가격으로 중고 참고가격과 판매글을 생성합니다. 사진 속 잠정 관찰은 확정 하자로 취급하지 않습니다.

기존 비전·구조화 응답 지원 모델과 웹 검색 지원 배포를 사용하며 별도 API 키는 필요하지 않습니다. AI·검색 호출에는 추가 비용이 발생할 수 있습니다. 가격 분석 없이 작성하려면 **판매글만 생성**을 사용합니다.

- 제품명·브랜드·모델명·카테고리만 검색에 전달하며, 구매가·사진·개인 메모는 제외합니다.
- 완료된 검색과 실제 응답 URL 인용이 있는 KRW 가격 후보만 표시합니다. 근거가 없으면 가격을 만들지 않습니다.
- 검색 인덱스 가격은 실시간 재고·결제가격 보장이 아닙니다. 자동 적용된 모델·용량·옵션과 배송비·할인 조건을 판매처 링크에서 검토해야 합니다. 전체 시장 최저가를 보장하지 않습니다.
- 자동 기준가격은 이번 AI 생성에만 사용하며 기존 제품 가격 기록을 덮어쓰지 않습니다. 중고 가격은 여전히 참고 추정치입니다.
- 로그인한 사용자별 서버 인스턴스당 분당 3회, 한 요청당 검색 도구 호출 최대 2회로 제한합니다. 전역 비용 한도는 아닙니다.
- 웹 검색 데이터는 Grounding with Bing으로 전달되며 Azure 데이터 경계 밖에서 처리될 수 있습니다. [Microsoft 웹 검색 문서](https://learn.microsoft.com/azure/foundry/openai/how-to/web-search)를 참고하세요.

## 실제 배포 전 필수 작업

1. 서버 인증과 세션 또는 JWT 기반 사용자 인증
2. 서버 API에서 사용자 소유권 검증
3. 데이터베이스로 User, Product, PriceSnapshot, ConditionCheck, SellPreparation, TrustSheet 저장
4. Blob 또는 S3 계열 이미지 저장소 연결
5. 실제 신제품 가격 API와 출처·실패·최신성 처리
6. AI 판매글 생성 API를 서버에서 호출하고 비밀키를 클라이언트에 노출하지 않기
7. Trust Sheet 공개 응답에서 서버가 공개 필드만 반환하도록 구현
8. `/trust/:token` SPA 새로고침 fallback 설정
9. 이미지 및 API rate limit, 로그, 백업, 개인정보 삭제 정책 추가
10. E2E 테스트와 배포 환경 smoke test 추가

현재 가격 데이터와 로그인은 실제 외부 서비스가 아니라 명시된 프로토타입 데이터입니다. 따라서 현재 상태는 발표·시연용 MVP이며, 위 항목을 처리하기 전에는 상용 배포용으로 간주하면 안 됩니다.

## 문서

- `prd.md`: 제품 요구사항과 MVP 완료 기준
- `agent.md`: 바이브코딩용 프로젝트 개발 지침
