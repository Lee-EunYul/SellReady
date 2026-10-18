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

현재 앱은 프로토타입 단계로 `localStorage`에 데이터를 저장합니다. 브라우저를 바꾸거나 저장소를 삭제하면 데이터가 사라질 수 있으며, 여러 사용자가 실제로 사용하는 보안 인증이 아닙니다.

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
