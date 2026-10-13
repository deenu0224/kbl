/** 배포 주소 (공유 링크·OG 메타와 같아야 한다) */
export const SHARE_BASE = 'https://deenu0224.github.io/kbl/';
/** 링크 미리보기·카카오톡 피드에 쓰는 고정 대표 이미지 */
export const SHARE_IMAGE = `${SHARE_BASE}og.png`;

/**
 * 카카오 JavaScript 키. 비어 있으면 카카오톡 버튼은 시스템 공유(또는 링크 복사)로 대신한다.
 * 넣는 법: developers.kakao.com → 앱 생성 → 앱 키의 JavaScript 키 → 플랫폼 Web 에 https://deenu0224.github.io 등록 → 아래에 입력.
 */
export const KAKAO_JS_KEY = '';
/**
 * 카카오 SDK 주소 (키가 있을 때만, 버튼을 누른 순간에 불러온다).
 * 배포 전 Kakao 문서(developers.kakao.com/docs/latest/ko/javascript/getting-started)의 최신 버전·integrity 로 교체할 것.
 */
export const KAKAO_SDK_URL = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js';
