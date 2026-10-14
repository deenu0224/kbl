# 수익화 조사와 실행 계획 — "답답해서 내가 / 야구 단장을 해도 될까?"

작성: 2026-10-14 (공개 2일차 기준). 읽는 사람: 제작자(1인 개발, 한국 거주).
목표: "다음 달에 무엇을 할지" 정하는 것. 후원 링크 말고 **사업으로 돈을 버는 길**을 찾는다.

> 숫자 표기 규칙: 출처가 있는 숫자는 끝에 [번호]를 붙였다(출처 목록은 문서 끝). 출처가 없는 숫자는 **추정**이라고 쓴다. 세금·법률 내용은 개요일 뿐이니 **세무사·전문가 확인이 필요하다.**

---

## 0. 게임과 현재 상태 요약

### 게임
- 브라우저에서 도는 **픽셀 야구 구단 경영 게임**. 제주 감귤 조합이 주인인 **도민 구단 "제주 탠저린즈"**의 단장이 된다.
- 만년 꼴찌, 낡은 6,000석 구장. 리그가 **연고 이전 심사**를 시작해서 육지 도시가 팀을 데려가려 한다. 도민 지지가 0 이하가 되면 팀이 섬을 떠난다(게임 오버).
- 가상 **10구단 리그**, 한 시즌 81경기(옛 세이브는 8구단 84경기). 가을야구 5팀(와일드카드 포함).
- 장(스테이지) 구성: 0 고장 난 팀 → 1 돌아온 관중 → 2 가을야구 → 3 한국시리즈로 → 4 제주의 기적(우승) → 5 왕조(무한). 장마다 깃발 1개 + 별 3개. 닌텐도식 레벨디자인(한 장 = 한 동사).
- 하는 일: 타순·영입·방출·티켓값·증축·대출·육성·드래프트. 사건 카드, 주간 브리핑.
- **핵심 긴장 = 빚(대출·자금)과 도민 지지.** 돈이 없는 이유는 주인이 농민이라서다.
- 도전과제 200개(보상 없음, 관찰만). 공유 카드(`?from=` 로 유입 추적).

### 지금 운영 상태
| 항목 | 상태 |
|---|---|
| 호스팅 | 정적 웹, GitHub Pages, 도메인 ddhsido.app |
| 서버·계정·결제 | 없음. 세이브는 브라우저 localStorage |
| 통계 | GoatCounter 익명 이벤트(첫 경기·시즌 결산·장 도달·연고 이전·공유 유입) |
| 공개 2일차 숫자 | 새 게임 33 · 첫 경기 23 · 첫 시즌 완주 7 · 우승 2 |
| 의견 | 구글 폼 |
| 돈 | 카카오페이 송금 링크(후원, 게임 안 대가 없음) |
| 라이선스 | 없음. 구단·선수 전부 가상. 구단 이름만 KBO 를 연상시킴 |

공개 2일차 깔때기: 새 게임 33 → 첫 경기 23(70%) → 첫 시즌 완주 7(21%) → 우승 2(6%). **표본이 너무 작아서 이 비율로 결정을 내리면 안 된다.** 다만 "첫 시즌 81경기를 끝까지 하는 사람이 5명 중 1명"이라는 감은 잡힌다.

### 제약
1. **GitHub Pages 는 상업 서비스용이 아니다.** 온라인 사업·전자상거래·SaaS 운영에 쓰지 말라고 되어 있다. 후원·스폰서 링크 정도는 허용된다는 해석이 일반적이다[1]. 결제를 붙이거나 유료판을 웹에서 팔면 **Cloudflare Pages 같은 곳으로 옮겨야 한다.** Cloudflare Pages 무료 요금제에는 상업 이용 금지 조항이 없다고 알려져 있다[2](직접 약관 재확인 필요).
2. **1인 개발.** 서버 운영·고객 응대·환불 처리를 혼자 감당해야 한다.
3. **사업자 등록.** 국내 PG(토스페이먼츠 등)로 돈을 받으려면 사업자 등록이 필수다[3].
4. **실명 라이선스 없음.** KBO 구단·선수 이름·로고는 못 쓴다. KBO 라이선스는 컴투스(OOTP 소유)처럼 큰 회사가 갖고 있다[4]. 1인 개발자가 받을 길은 현실적으로 없다고 본다(추정).
5. **게임 등급분류.** 한국에 유통하는 게임은 등급분류 대상이다[5]. 스토어(구글·애플·스토브)는 자체등급분류로 처리되고, 스토브인디는 비용이 무료다[6]. **유료 웹판을 직접 팔 때 등급분류를 어떻게 받는지는 확인하지 못했다 — 게임물관리위원회 문의 필요.**

---

## 1. 조사 메모

### 1-1. 비슷한 게임의 수익 모델

| 게임 | 형태 | 가격 | 결제 구조 | 평가 | 시사점 |
|---|---|---|---|---|---|
| Out of the Park Baseball 27 | PC 패키지, 매년 새 번호 | $49.99 (할인 시 $29.99) | 연간 신작 + 온라인 카드 모드(Perfect Team) | Steam 약 365~418개, 대체로 긍정[7] | 니치 장르도 "깊이"로 정가를 받는다. KBO 라이선스 보유[4] |
| Football Manager 26 | PC 패키지, 매년 | $59.99 | 연간 신작. 모바일판은 넷플릭스 구독에 포함[8][9] | Steam 약 13,390개 중 36% 긍정(UI 혹평)[8] | 큰 회사도 출시 품질로 평판이 무너진다. 모바일은 구독 묶음으로 간 사례 |
| Home Run High (카이로소프트) | 픽셀 경영, 유료 | Steam 정가 $14, 할인 $4.49 | 단품 유료, 여러 플랫폼 | Steam 151개 "대체로 긍정", 구글 플레이 3.2천 평가 4.2점[10] | **가장 가까운 비교 대상.** 픽셀 야구 경영도 단품 유료로 팔린다. 다만 Steam 리뷰 수는 작다 |
| Pocket League Story (카이로소프트) | 픽셀 축구 경영 | $8.99 | 단품 유료 | 155개, 89% 긍정[10] | 같은 계열. 리뷰 150개 안팎이 이 장르 인디의 현실적 크기(추정) |
| Astonishing Baseball Manager | 인디 야구 경영 | 확인 못 함 | 단품 | 87개, 82% 긍정[11] | 텍스트형 니치 경영도 Steam 에 자리가 있다 |
| Baseball Empire | 인디 야구 경영(2026-07 출시) | $19.99 | 단품 | 확인 못 함[12] | 같은 해 경쟁작 |
| 컴투스프로야구 for 매니저 | 모바일, KBO 라이선스 | 무료 | 부분 유료(뽑기·아이템)[13] | — | 한국 야구 경영 모바일의 표준은 **라이선스 + 부분 유료**. 우리는 둘 다 따라 하면 안 된다(라이선스 없음, 긴장 붕괴) |
| 프로야구 H3 (엔씨) | 모바일·PC | 무료 | 부분 유료(확인 못 함) | — | 대기업 영역 |

참고: Steam 리뷰 1개당 판매 30~60개라는 업계 어림셈이 있다(**추정**, 출처 확인 못 함). 리뷰 150개면 판매 수천~1만 장 수준이라는 감만 잡는다.

### 1-2. 플랫폼별 조건과 수수료

| 플랫폼 | 등록비 | 수수료(개발자 몫) | 조건·메모 |
|---|---|---|---|
| Steam | 게임당 $100, 매출 $1,000 넘으면 돌려받음 | 30% (1천만 달러 까지), 그 위로 25%·20%[14] | 데스크톱 앱 형태 필요(웹 게임은 Electron/Tauri 로 감싸서 낸다). 위시리스트 → 첫 주 판매 전환 중앙값 약 0.10~0.15배(10달러 이상은 0.10배)[15] |
| 스토브인디 | 확인 못 함 | 플랫폼 수수료 **15%**[6] | 자체 등급분류 무료[6]. 국내 인디 유저층, QA·피드백 평이 좋다 |
| itch.io | 없음 | 기본 10%, 개발자가 0~100% 직접 정함 + 결제 수수료(예: $10 판매 시 약 $8.41 남음)[16] | 웹 게임을 그대로 올릴 수 있다. "원하는 만큼 내기(PWYW)" 지원 |
| CrazyGames | 없음 | 광고 수익 약 60%, 인앱 결제 70%(성과에 따라 50~70%)[17] | 웹 게임 포털. 독점 아님. 약 2주 시험 출시 후 지표가 좋으면 정식 |
| Poki | 없음 | 직접 유입 100%, Poki 유입 50:50[17] | 손으로 골라 받음. **웹 독점**(스팀·모바일은 가능)[17] — 우리 도메인 운영과 충돌 |
| 구글 플레이 | $25 1회 | 15% (연 100만 달러까지, 신청 필요)[18] | TWA(웹을 앱으로 감싸기) 가능. 단 Play 결제 정책을 따라야 하고 Lighthouse 성능 80점 기준[19] |
| 애플 앱스토어 | 연 $99 | 15% (소규모 사업자 프로그램)[18] | **웹을 감싼 앱은 4.2(최소 기능) 거절이 가장 흔하다**[20]. 오프라인 동작·네이티브 요소 필요 |
| 웹 직접 결제(토스페이먼츠 등) | 없음(가입 심사) | PG 수수료 약 3%대(**추정**, 업종·조건별 다름) | **사업자 등록 필수**[3]. 포트원은 여러 PG 연동 도구. 비사업자 개인용 링크 결제(페이앱 라이트 등)도 있으나 사업 용도로 적합한지는 확인 필요[21] |
| 웹 광고(애드센스) | 없음 | 구글 몫 제외 후 지급(정확한 비율은 형식별) | 게임 페이지 승인: 독창적·버그 없음·모바일 대응·개인정보처리방침[22]. **H5 게임 광고(전면·보상형)는 비공개 베타, 승인 보장 없음**[22]. HTML5 게임은 "세션 RPM" 1~2달러 수준 예시가 있다[23](미국 기준 예시, 한국 트래픽은 더 낮을 것 — 추정) |
| 텀블벅 | 없음 | 플랫폼 5%/9%/15%(요금제별, VAT 별도) + 결제 3%[24] | 성공 시에만 수수료. 사전 알림 신청 기능으로 수요를 미리 잴 수 있다 |

### 1-3. 한국 1인 개발자의 사업자·세금 개요 (전문가 확인 필요)

- **사업자 등록**: 국내 PG·텀블벅 정산·스폰서 세금계산서를 하려면 사실상 필요. 업종 코드는 게임 소프트웨어 개발(722001) 등이 거론된다[25]. 정보통신업 코드는 요건을 맞추면 청년 창업 세액 감면 대상이 될 수 있다[25].
- **간이과세자**: 연 매출 1억 400만 원 미만. 연 매출 4,800만 원 미만이면 부가세 납부가 면제되지만 신고는 해야 한다[26].
- **통신판매업 신고**: 직전 연도 통신판매 50회 미만이거나 간이과세자면 신고를 면제받을 수 있다. 하지만 전자상거래법의 표시·환불 의무는 그대로다[27].
- **해외 스토어 수익**(Steam·itch.io 등): 해외 플랫폼에서 받는 돈도 종합소득세 신고 대상. 부가세 처리(영세율 등)는 판매 구조에 따라 다르다[25]. **세무사 확인 필요.**
- **등급분류**: 스토어 자체등급분류로 대부분 해결. 직접 판매 웹판은 확인 필요(0절 제약 5).

### 1-4. 스폰서·콜라보 사례

- **독립야구단 후원 구조**: 경기도 독립리그는 2026년 9개 구단. 연천 미라클은 지자체(연천군)와 지역 농협 브랜드(본래순대)의 후원을 받는다[28]. → 독립구단도 **지역 기업 + 지자체** 스폰서로 산다. 우리 게임의 "도민 구단" 설정과 같은 그림이다.
- **제주 지원사업**: 제주콘텐츠진흥원 "JEMI 디딤돌"(콘텐츠 초기 창업 10개사, 각 3천만 원, 2026년 4월 마감)[29], "제주형 융복합 문화콘텐츠 상품 제작 지원"(제주 문화 원형 + 이종 산업)[30]. **제주 소재가 직접 맞는다.** 2027년 공고 시기 확인 필요. 대부분 사업자 등록·제주 소재 요건이 있을 것(추정).
- **야구 유튜버·스트리머**: 선수 출신 유튜버(예: 유희관 채널 약 20.7만 구독)가 활발하다[31]. 인디 야구 게임과 협업한 국내 사례는 **찾지 못했다.** 전례가 없다는 건 기회일 수도, 수요가 없다는 뜻일 수도 있다.
- **업계 스폰서 예**: 프로스펙스가 대한야구소프트볼협회와 2029년까지 후원 연장[32] — 아마추어 야구에도 스폰서 시장이 있다는 정도의 근거.

### 1-5. 조사에서 얻은 결론 (짧게)
1. 이 장르는 **단품 유료**가 통한다(카이로소프트, OOTP). 부분 유료는 라이선스가 있는 대기업 판이다.
2. 1인 개발자의 가장 싼 유료 판매 경로는 **itch.io(수수료 직접 설정) → 스토브인디(15%) → Steam(30%, $100)** 순이다. 셋 다 결제·세금 계산서를 플랫폼이 대신 처리한다.
3. 웹에서 직접 돈을 받는 순간 **사업자 등록 + 호스팅 이전 + 등급분류 확인**이 한꺼번에 따라온다. 지금 규모에서는 비싸다.
4. 광고는 지금 트래픽(하루 수십 명)으로는 의미가 없다(2절 계산).
5. **제주**라는 소재가 지원사업·지역 스폰서와 직접 연결된다. 이게 다른 인디 야구 게임에 없는 무기다.

<!-- 2절(아이디어 표)과 3절(결론)은 아래 출처 목록 위에 들어간다 -->

---

## 출처

1. GitHub Pages 상업 이용 관련 — https://github.com/orgs/community/discussions/74742 , https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages
2. Cloudflare Pages 무료 요금제 비교 — https://htmlpub.com/blog/static-site-hosting-comparison-2026 , https://vpsranking.com/serverless/cloudflare-pages/
3. 토스페이먼츠 사업자 등록 필요 — https://www.tosspayments.com/blog/articles/business-registration , https://www.tosspayments.com/quick-open
4. OOTP 의 KBO 라이선스·컴투스 인수 — https://gmgames.org/2020/10/12/com2us-korea-has-acquired-100-percent-stake-of-out-of-the-park-developments-ootp-germany/ , https://30-30.club/encyclopedia/index.php/OOTP24
5. 게임 등급분류 일반 — https://www.gamemeca.com/view.php?gid=524981 , https://www.inews24.com/view/1353740
6. 스토브인디 수수료 15%·자체 등급분류 — https://www.g-enews.com/article/ICT/2023/04/2023042505241010273b60030fa2_1 , https://news.bizwatch.co.kr/article/mobile/2023/04/21/0031 , https://zdnet.co.kr/view/?no=20241105110419
7. OOTP 27 가격·평가 — https://store.steampowered.com/app/4045750/Out_of_the_Park_Baseball_27 , https://steampulse.org/game/4045750 , https://www.wasdland.com/game/out-of-the-park-baseball-27-4045750/
8. FM26 가격·평가 — https://www.steampulse.org/game/3551340 , https://insider-gaming.com/football-manager-26-cracks-steams-all-time-top-10-worst-games-list/
9. FM 모바일 넷플릭스 독점 — https://www.footballmanager.com/news/football-manager-2024-mobile-coming-exclusively-netflix
10. 카이로소프트 Home Run High·Pocket League Story — https://store.steampowered.com/app/2084720/ , https://www.dekudeals.com/items/home-run-high , https://steamspy.com/app/2084720
11. Astonishing Baseball Manager — https://raijin.gg/app/1680650/Astonishing_Baseball_Manager
12. Baseball Empire — https://gg.deals/game/baseball-empire/
13. 컴투스프로야구 for 매니저 — https://apps.apple.com/us/app/-/id682942443
14. Steam Direct·수수료 구간 — https://presskit.gg/field-guides/how-much-does-steam-take , https://fungies.io/how-to-sell-games-on-steam/
15. 위시리스트 전환율 — https://gamedevreports.substack.com/p/gamediscoverco-the-state-of-steam , https://newsletter.gamediscover.co/p/we-need-to-take-wishlist-quality
16. itch.io 수익 배분 — https://itch.io/docs/creators/payments , https://itch.io/updates/open-revenue-sharing
17. CrazyGames·Poki 조건 — https://app.cinevva.com/guides/publish-game-crazygames , https://app.cinevva.com/guides/publish-game-poki , https://playgama.com/blog/?p=14181
18. 구글 플레이·애플 수수료 — https://appbot.co/blog/app-developers-apple-google-small-business-programs/ , https://splitmetrics.com/blog/google-play-apple-app-store-fees/
19. TWA 정책 — https://www.i-programmer.info/news/81-web-general/12521-pwa-becomes-twa-and-enters-play-store.html , https://developers-jp.googleblog.com/2019/03/trusted-web-activity.html
20. 애플 4.2 웹 래퍼 거절 — https://www.mobiloud.com/blog/app-store-review-guidelines-webview-wrapper , https://www.technetexperts.com/guideline-4-2-minimum-functionality/
21. 포트원·페이앱 라이트 — https://blog.portone.io/opi_pg-comparison2026/ , https://www.card-gorilla.com/contents/detail/1157
22. 애드센스 H5 게임 광고 — https://support.google.com/adsense/answer/9959170?hl=en , https://blog.clickio.com/h5-game-ads-google-ad-manager-adsense/
23. HTML5 게임 세션 RPM 예시 — https://www.adpushup.com/blog/HTML5-game-ads/
24. 텀블벅 수수료 — https://docs.channel.io/tumblbug/ko/articles/41c91590
25. 게임 개발 업종 코드·해외 플랫폼 수익 세무 — https://www.taxwatch.co.kr/article/tax/2022/05/16/0002 , https://ai.bznav.com/contents/3296773
26. 간이과세자 기준 — https://wikidocs.net/blog/@Insight_Lab/22788/ , https://help.3o3.co.kr/hc/ko/articles/10940502744217
27. 통신판매업 신고 면제 — https://thecheck.co.kr/mail-order-business-report-exemption/ , https://kmong.com/support/expert-center/posts/671
28. 경기도 독립리그·연천 미라클 후원 — https://www.kyeonggi.com/article/20260319580208 , https://www.nocutnews.co.kr/news/6052673
29. 제주콘텐츠진흥원 JEMI 디딤돌 — https://www.kukinews.com/article/view/kuk202502030022
30. 제주형 융복합 문화콘텐츠 상품 제작 지원 — https://grant-documents.thevc.kr/295475_%EB%B6%99%EC%9E%84.+2026+%EC%A0%9C%EC%A3%BC%ED%98%95+%EC%9C%B5%EB%B3%B5%ED%95%A9+%EB%AC%B8%ED%99%94%EC%BD%98%ED%85%90%EC%B8%A0%EC%83%81%ED%92%88+%EC%A0%9C%EC%9E%91%EC%A7%80%EC%9B%90%EC%82%AC%EC%97%85+%EA%B3%B5%EA%B3%A0%EB%AC%B8.pdf
31. 야구 선수 출신 유튜브 채널 — https://www.i-boss.co.kr/ab-74668-4312
32. 프로스펙스·대한야구소프트볼협회 후원 — https://www.koreatimes.co.kr/amp/business/companies/20260513/pro-specs-korea-baseball-softball-association-ink-sponsorship-extension-through-2029
33. 마플샵 주문 제작 굿즈 — https://docs.channel.io/cime/ko/articles/%EB%A7%88%ED%94%8C%EC%83%B5-%EA%B0%9C%EC%84%A4%ED%95%98%EA%B8%B0-e32f8ed9 , https://news.bizwatch.co.kr/article/mobile/2020/09/28/0008

웹 검색 결과 요약을 바탕으로 했다. 일부 숫자(리뷰 수, 할인가)는 조회 시점에 따라 달라진다. 수수료·약관은 실행 전에 각 공식 페이지에서 다시 확인한다.
