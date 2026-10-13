import { KAKAO_JS_KEY, KAKAO_SDK_URL, SHARE_IMAGE } from './config';
import type { ShareData } from './shareData';

interface KakaoSdk {
  isInitialized(): boolean;
  init(key: string): void;
  Share: { sendDefault(opts: unknown): void };
}
declare global {
  interface Window {
    Kakao?: KakaoSdk;
  }
}

export const kakaoReady = (): boolean => KAKAO_JS_KEY.length > 0;

let loading: Promise<KakaoSdk> | null = null;

/** 키가 있을 때만, 처음 누른 순간에 SDK 를 불러온다 */
function loadKakao(): Promise<KakaoSdk> {
  if (window.Kakao) return Promise.resolve(window.Kakao);
  loading ??= new Promise<KakaoSdk>((ok, no) => {
    const s = document.createElement('script');
    s.src = KAKAO_SDK_URL;
    s.async = true;
    s.crossOrigin = 'anonymous'; // 배포 전 Kakao 문서의 최신 버전·integrity 로 교체 (config.ts)
    s.onload = () => (window.Kakao ? ok(window.Kakao) : no(new Error('Kakao SDK 없음')));
    s.onerror = () => {
      loading = null;
      no(new Error('Kakao SDK 를 불러오지 못했습니다'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** 카카오톡 피드 템플릿: 제목 = 대답 줄, 설명 = 구단·시즌 줄, 버튼 = 도전 링크 */
export function kakaoTemplate(d: ShareData): unknown {
  const link = { mobileWebUrl: d.url, webUrl: d.url };
  return {
    objectType: 'feed',
    content: { title: `야구 단장을 해도 될까? → ${d.answer}`, description: `${d.club}\n${d.ranks} · ${d.detail}`, imageUrl: SHARE_IMAGE, link },
    buttons: [{ title: '같은 리그로 도전', link }],
  };
}

export async function kakaoShare(d: ShareData): Promise<void> {
  const k = await loadKakao();
  if (!k.isInitialized()) k.init(KAKAO_JS_KEY);
  k.Share.sendDefault(kakaoTemplate(d));
}
