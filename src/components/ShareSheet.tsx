import { useEffect, useMemo, useRef, useState } from 'react';
import { track } from '../analytics';
import type { HofClub } from '../game/hof';
import type { StadiumScene } from '../game/types';
import { cardScene, clubScene, renderCard, CARD_H, CARD_W } from '../share/card';
import { NOTE_MAX } from '../share/config';
import { shareFromClub, shareFromCore, sheetTitle, type ShareData, type ShareKind } from '../share/shareData';
import { shareText, threadsIntent, xIntent } from '../share/story';
import { pickCore, useStore } from '../store';

const NOTE_HINTS = ['예: 야구는 보는 게 제일 쉬웠다', '예: 그 단장도 사정이 있었구나'];
const open = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 공유 화면: 한 줄 소감 → [글과 링크 복사] → X · 스레드 → 올라갈 글 보기 → 기록 카드(이미지 저장 · 다른 앱으로 보내기) */
export default function ShareSheet({ data, scene, club = false, onClose }: { data: ShareData; scene: StadiumScene; club?: boolean; onClose: () => void }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState('');
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
      () => alive && setFailed(true), // 카드를 못 만들어도 글은 공유할 수 있다
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

  const text = useMemo(() => shareText(data, note), [data, note]);
  const fileName = `kbl-${data.code}-${data.rec.seed.toString(36)}.png`;
  const canNative = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  /** 시스템 공유 창: 이미지 파일을 받을 수 있으면 이미지째, 아니면 글만 (주소는 글 안에 있다) */
  const native = async () => {
    const files = blob ? [new File([blob], fileName, { type: 'image/png' })] : [];
    track('share-native');
    try {
      await navigator.share(files.length && navigator.canShare?.({ files }) ? { text, files } : { text });
    } catch {
      /* 사용자가 닫았다 */
    }
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
          <span className="font-pixel-lg text-[18px] text-hi" data-testid="share-title">
            {sheetTitle(data.rec.kind, club)}
          </span>
          <button className="px-btn min-h-11 px-4 text-[14px]" data-testid="share-close" onClick={onClose}>
            닫기
          </button>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-white/75">한 줄 소감 (선택)</span>
          <input
            className="min-h-11 w-full bg-ink px-2 text-white select-text"
            style={{ fontSize: 16, boxShadow: '0 0 0 2px #0f1420' }}
            data-testid="share-note-input"
            value={note}
            maxLength={NOTE_MAX}
            placeholder={NOTE_HINTS[(data.rec.seed + data.rec.seasons) % NOTE_HINTS.length]}
            enterKeyHint="done"
            onChange={(e) => setNote(e.target.value)}
          />
          <span className="flex justify-between gap-2 text-white/55">
            <span>쓰면 공유하는 글의 맨 앞에 들어가요</span>
            <span>
              {[...note].length}/{NOTE_MAX}
            </span>
          </span>
        </label>
        <button
          className="px-btn primary flex min-h-[58px] flex-col items-center justify-center !py-1.5 leading-tight"
          data-testid="share-copy"
          onClick={async () => (track('share-copy'), say((await copy(text)) ? '복사했습니다 — 대화방에 붙여넣으세요' : '복사하지 못했습니다 — [올라갈 글 보기]에서 직접 복사하세요'))}
        >
          <span className="text-[17px]">글과 링크 복사</span>
          <span className="mt-0.5 text-[13px] text-white/75">카톡 대화방에 붙여넣기</span>
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button className={btn} data-testid="share-x" onClick={() => (track('share-x'), open(xIntent(text)))}>
            X에 올리기
          </button>
          <button className={btn} data-testid="share-threads" onClick={() => (track('share-threads'), open(threadsIntent(text)))}>
            스레드에 올리기
          </button>
        </div>
        <div className="min-h-[20px] text-center leading-snug" data-testid="share-note">
          {msg ? <span className="text-hi">{msg}</span> : null}
        </div>
        <details className="bg-ink/60" data-testid="share-text-box">
          <summary className="flex min-h-11 cursor-pointer items-center px-2 text-white/85" data-testid="share-text-toggle">
            ▶ 올라갈 글 보기
          </summary>
          <div className="px-2 pb-2 leading-relaxed break-all whitespace-pre-wrap text-white/85 select-text" data-testid="share-text">
            {text}
          </div>
        </details>
        <div className="mx-auto w-full max-w-[260px] bg-ink short:max-w-[170px]" style={{ aspectRatio: `${CARD_W} / ${CARD_H}`, boxShadow: '0 0 0 2px #0f1420' }}>
          {src ? (
            <img src={src} alt="기록 카드" className="block h-full w-full" data-testid="share-card" />
          ) : (
            <div className="flex h-full items-center justify-center text-white/55">{failed ? '카드를 만들지 못했습니다' : '카드 만드는 중…'}</div>
          )}
        </div>
        <div className={`grid gap-2 ${canNative ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {src ? (
            <a className={`${btn} flex items-center justify-center`} href={src} download={fileName} data-testid="share-save">
              이미지 저장
            </a>
          ) : (
            <button className={btn} disabled>
              이미지 저장
            </button>
          )}
          {canNative && (
            <button className={btn} data-testid="share-native" onClick={native}>
              다른 앱으로 보내기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 결산·엔딩·연고 이전 화면의 [공유] 버튼 (누르면 그 순간의 세이브로 시트를 연다) */
export function ShareButton({ kind, className = '', label = '공유' }: { kind: ShareKind; className?: string; label?: string }) {
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
        {label}
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
      {sheet && <ShareSheet data={sheet.data} scene={sheet.scene} club onClose={() => setSheet(null)} />}
    </>
  );
}
