import { useState } from 'react';
import { create } from 'zustand';
import Dialog from './layout/Dialog';
import { APP_VERSION, RELEASE_NOTES, notesSince, type ReleaseNote } from '../releaseNotes';

// 업데이트 소식: 새 버전이 나온 뒤 처음이면 초기 화면에 점, 누르면 그 사이 바뀐 것만. 설정에서 전체 보기.
const SEEN_KEY = 'kbl-seen-version';
const readSeen = (): string | null => {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return APP_VERSION; // 저장소를 못 쓰면 점을 띄우지 않는다
  }
};

export const useWhatsNew = create<{ open: 'new' | 'all' | null; seen: string | null }>(() => ({ open: null, seen: readSeen() }));

export const hasNews = (seen: string | null) => seen !== APP_VERSION;

export function openWhatsNew(mode: 'new' | 'all') {
  useWhatsNew.setState({ open: mode });
}

function close() {
  try {
    localStorage.setItem(SEEN_KEY, APP_VERSION);
  } catch {
    /* 이번 세션만 */
  }
  useWhatsNew.setState({ open: null, seen: APP_VERSION });
}

function Note({ n }: { n: ReleaseNote }) {
  return (
    <div className="flex flex-col gap-1 bg-panel-2 p-2" style={{ boxShadow: '0 0 0 1px #121110' }} data-testid="release-note">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-pixel-lg text-[15px] text-hi">
          v{n.version} · {n.title}
        </span>
        <span className="shrink-0 text-[12px] text-white/50">{n.date}</span>
      </div>
      <ul className="flex list-disc flex-col gap-1 pl-4 text-[13px] leading-snug text-white/85">
        {n.notes.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
      <div className={`text-[12px] ${n.save === false ? 'text-bad' : 'text-white/50'}`}>{n.save === false ? '이번 버전은 세이브가 이어지지 않습니다' : '세이브는 그대로 이어집니다'}</div>
    </div>
  );
}

/** 업데이트 소식 창 (App 에 한 번 둔다) */
export default function WhatsNew() {
  const open = useWhatsNew((s) => s.open);
  const seen = useWhatsNew((s) => s.seen);
  const [all, setAll] = useState(false);
  if (!open) return null;
  const list = open === 'all' || all ? RELEASE_NOTES : notesSince(seen);
  return (
    <div className="relative z-[85]">
      <Dialog onClose={close} label="업데이트 소식" width={480}>
        <div className="flex flex-col gap-2 text-[13px]" data-testid="whats-new">
          <div className="font-pixel-lg text-[16px] text-hi">업데이트 소식</div>
          {list.map((n) => (
            <Note key={n.version} n={n} />
          ))}
          {open === 'new' && !all && RELEASE_NOTES.length > list.length && (
            <button className="px-btn min-h-10 text-[13px]" onClick={() => setAll(true)}>
              지난 소식 전체 보기
            </button>
          )}
        </div>
      </Dialog>
    </div>
  );
}

/** 초기 화면 구석: 버전과 새 소식 점 */
export function VersionBadge() {
  const seen = useWhatsNew((s) => s.seen);
  const fresh = hasNews(seen);
  return (
    <button className="relative flex min-h-9 items-center gap-1.5 px-2 text-[12px] text-white/55" data-testid="version-badge" onClick={() => openWhatsNew(fresh ? 'new' : 'all')}>
      v{APP_VERSION} · 업데이트 소식
      {fresh && <span className="inline-block h-2 w-2 rounded-full bg-bad" data-testid="news-dot" />}
    </button>
  );
}
