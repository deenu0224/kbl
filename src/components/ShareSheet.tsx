import { useEffect, useMemo, useRef, useState } from 'react';
import type { HofClub } from '../game/hof';
import type { StadiumScene } from '../game/types';
import { cardScene, clubScene, renderCard, CARD_H, CARD_W } from '../share/card';
import { kakaoReady, kakaoShare } from '../share/kakao';
import { fullText, shareFromClub, shareFromCore, threadsIntent, xIntent, type ShareData, type ShareKind } from '../share/shareData';
import { pickCore, useStore } from '../store';

const open = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 공유 시트: 카드 미리보기 + 공유하기(시스템 공유) · X · 스레드 · 카카오톡 · 이미지 저장 · 문구 복사 */
export default function ShareSheet({ data, scene, onClose }: { data: ShareData; scene: StadiumScene; onClose: () => void }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [failed, setFailed] = useState(false);
  const [msg, setMsg] = useState('');
  const timer = useRef(0);
  const say = (t: string) => {
    setMsg(t);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(''), 2600);
  };

  useEffect(() => {
    let alive = true;
    renderCard(data, scene).then(
      (b) => alive && setBlob(b),
      () => alive && setFailed(true), // 카드를 못 만들면 문구만 공유한다
    );
    return () => {
      alive = false;
    };
  }, [data, scene]);
  const src = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => void (src && URL.revokeObjectURL(src)), [src]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(timer.current);
    };
  }, [onClose]);

  const fileName = `kbl-${data.kind}-${data.seed.toString(36)}.png`;
  const canNative = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  /** 시스템 공유 창: 이미지 파일을 받을 수 있으면 이미지째, 아니면 문구와 주소만 */
  const native = async (): Promise<boolean> => {
    if (!canNative) return false;
    const base = { text: data.text, url: data.url };
    const files = blob ? [new File([blob], fileName, { type: 'image/png' })] : [];
    try {
      await navigator.share(files.length && navigator.canShare?.({ files }) ? { ...base, files } : base);
    } catch {
      /* 사용자가 닫았다 */
    }
    return true;
  };
  const shareMain = async () => {
    if (await native()) return;
    say((await copy(fullText(data))) ? '문구를 복사했습니다 — 원하는 곳에 붙여넣으세요' : '이 브라우저에서는 공유 창을 열 수 없습니다');
  };
  const kakao = async () => {
    if (kakaoReady()) {
      try {
        return await kakaoShare(data);
      } catch {
        /* SDK 를 못 불러오면 아래 방법으로 */
      }
    }
    if (await native()) return;
    say((await copy(fullText(data))) ? '링크를 복사했습니다 — 카카오톡에 붙여넣으세요' : '복사하지 못했습니다');
  };

  const btn = 'px-btn min-h-11 whitespace-nowrap text-[14px]';
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/90 p-3 font-pixel text-[13px] select-none mob:items-end mob:p-0" role="dialog" aria-label="공유" data-testid="share-sheet" onClick={onClose}>
      <div
        className="px-panel px-scroll flex max-h-full w-full max-w-[420px] flex-col gap-2 overflow-y-auto p-3"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-pixel-lg text-[18px] text-hi">공유</span>
          <button className="px-btn min-h-11 px-4 text-[14px]" data-testid="share-close" onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="mx-auto w-full max-w-[220px] bg-ink short:max-w-[150px]" style={{ aspectRatio: `${CARD_W} / ${CARD_H}`, boxShadow: '0 0 0 2px #0f1420' }}>
          {src ? (
            <img src={src} alt="공유 카드" className="block h-full w-full" data-testid="share-card" />
          ) : (
            <div className="flex h-full items-center justify-center text-white/55">{failed ? '카드를 만들지 못했습니다' : '카드 만드는 중…'}</div>
          )}
        </div>
        <div className="bg-ink/60 px-2 py-1.5 leading-snug break-all whitespace-pre-wrap text-white/85 select-text" data-testid="share-text">
          {fullText(data)}
        </div>
        <button className="px-btn primary min-h-[52px] text-[17px]" data-testid="share-native" onClick={shareMain}>
          공유하기
        </button>
        <div className="grid grid-cols-3 gap-2">
          <button className={btn} data-testid="share-x" onClick={() => open(xIntent(data))}>
            X
          </button>
          <button className={btn} data-testid="share-threads" onClick={() => open(threadsIntent(data))}>
            스레드
          </button>
          <button className={btn} data-testid="share-kakao" onClick={kakao}>
            카카오톡
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {src ? (
            <a className={`${btn} flex items-center justify-center`} href={src} download={fileName} data-testid="share-save">
              이미지 저장
            </a>
          ) : (
            <button className={btn} disabled>
              이미지 저장
            </button>
          )}
          <button className={btn} data-testid="share-copy" onClick={async () => say((await copy(fullText(data))) ? '문구를 복사했습니다' : '복사하지 못했습니다')}>
            문구 복사
          </button>
        </div>
        <div className="min-h-[36px] text-center leading-snug text-white/55" data-testid="share-note">
          {msg ? <span className="text-hi">{msg}</span> : 'X·스레드에는 글만 들어갑니다. 이미지는 [공유하기]나 [이미지 저장]으로'}
        </div>
      </div>
    </div>
  );
}

/** 결산·엔딩·연고 이전 화면의 [공유] 버튼 (누르면 그 순간의 세이브로 시트를 연다) */
export function ShareButton({ kind, className = '' }: { kind: ShareKind; className?: string }) {
  const [sheet, setSheet] = useState<{ data: ShareData; scene: StadiumScene } | null>(null);
  return (
    <>
      <button
        className={`px-btn min-h-11 whitespace-nowrap !px-4 text-[13px] ${className}`}
        data-testid="share-open"
        onClick={() => {
          const core = pickCore(useStore.getState());
          setSheet({ data: shareFromCore(core, kind), scene: cardScene(core, kind) });
        }}
      >
        공유
      </button>
      {sheet && <ShareSheet data={sheet.data} scene={sheet.scene} onClose={() => setSheet(null)} />}
    </>
  );
}

/** 명예의 전당의 역대 구단 줄에 붙는 작은 공유 버튼 */
export function ShareClubButton({ club }: { club: HofClub }) {
  const [sheet, setSheet] = useState<{ data: ShareData; scene: StadiumScene } | null>(null);
  return (
    <>
      <button className="px-btn flex h-10 w-10 shrink-0 items-center justify-center !p-0" aria-label={`${club.nick} 공유`} data-testid="share-club" onClick={() => setSheet({ data: shareFromClub(club), scene: clubScene(club) })}>
        <svg width="18" height="18" viewBox="0 0 9 9" shapeRendering="crispEdges" aria-hidden="true">
          <path fill="currentColor" d="M4 0h1v1h1v1h1v1H5v3H4V3H2V2h1V1h1zM1 5h1v3h5V5h1v4H1z" />
        </svg>
      </button>
      {sheet && <ShareSheet data={sheet.data} scene={sheet.scene} onClose={() => setSheet(null)} />}
    </>
  );
}
