import { useState } from 'react';
import type { EventCard } from '../game/types';
import { findPlayer, useStore } from '../store';
import { CHARACTERS } from '../game/story';
import PixelFace from './PixelFace';
import EventDetail from './EventDetail';
import Sheet from './layout/Sheet';
import { useUi } from './layout/uiStore';
import { POS_KO } from './ui';

/** 카드의 화자: 인물이면 story.ts 의 이름·직함·초상 시드, 'player' 면 관련 선수 본인 */
function useSpeaker(card: EventCard): { id: string; name: string; title: string; color: string; color2: string; foreign: boolean } | null {
  const teams = useStore((s) => s.teams);
  const freeAgents = useStore((s) => s.freeAgents);
  const userId = useStore((s) => s.userId);
  const team = teams.find((t) => t.id === userId);
  const color = team?.color ?? '#e2572e';
  const color2 = team?.color2 ?? '#ffffff';
  if (!card.who) return null;
  if (card.who === 'player') {
    const p = findPlayer({ teams, freeAgents }, card.pid);
    if (!p) return null;
    return { id: p.id, name: p.name, title: `${POS_KO[p.pos]} · ${p.age}세`, color, color2, foreign: p.foreign };
  }
  const ch = CHARACTERS[card.who];
  if (!ch) return null;
  // 유치위원장은 우리 구단 사람이 아니다
  const outsider = card.who === 'suitor';
  return { id: `char-${ch.seed}`, name: ch.name, title: ch.title, color: outsider ? '#56607e' : color, color2: outsider ? '#cfd6ea' : color2, foreign: false };
}

/** 선택지 줄: 줄을 누르면 상세가 열리고, 줄 안의 [선택] 만 바로 실행한다 (오탭 방지). detail 이 없는 구형 카드는 [선택] 만 */
function CardBody({ card, onOpen }: { card: EventCard; onOpen: (i: number) => void }) {
  const resolveEvent = useStore((s) => s.resolveEvent);
  const sp = useSpeaker(card);
  const setOpen = onOpen;
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-[20px] leading-none">{card.icon}</span>
        <span className="font-pixel-lg min-w-0 flex-1 text-[17px] leading-tight text-hi" style={{ textShadow: '1px 1px 0 #0f1420' }}>
          {card.title}
        </span>
      </div>

      {sp && (
        <div className="mt-2 flex items-start gap-2">
          <div className="shrink-0" style={{ boxShadow: `0 0 0 2px #0f1420, 0 0 0 3px ${sp.color2}` }}>
            <PixelFace id={sp.id} color={sp.color} color2={sp.color2} foreign={sp.foreign} size={64} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] leading-tight">
              {sp.name} <span className="text-[12px] text-white/55">{sp.title}</span>
            </div>
            {card.line && (
              <div className="mt-1 bg-ink/70 px-2 py-1.5 text-[13px] leading-snug text-white" style={{ boxShadow: 'inset 2px 0 0 #ffd84a' }}>
                “{card.line}”
              </div>
            )}
          </div>
        </div>
      )}
      {!sp && card.line && <div className="mt-2 bg-ink/70 px-2 py-1.5 text-[13px] leading-snug">“{card.line}”</div>}

      {card.body && <div className="mt-2 text-[13px] leading-snug text-white/80">{card.body}</div>}

      <div className="mt-2.5 flex flex-col gap-1.5">
        {(card.choices ?? []).map((ch, i) => (
          <div key={i} className="flex items-stretch gap-1.5 bg-ink/55 p-1.5" data-testid="ev-choice" style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)' }}>
            <div
              className={`flex min-h-12 min-w-0 flex-1 flex-col justify-center ${ch.detail ? 'cursor-pointer' : ''}`}
              role={ch.detail ? 'button' : undefined}
              tabIndex={ch.detail ? 0 : undefined}
              data-testid={ch.detail ? 'ev-more' : undefined}
              onClick={ch.detail ? () => setOpen(i) : undefined}
              onKeyDown={ch.detail ? (e) => e.key === 'Enter' && setOpen(i) : undefined}
            >
              <span className="text-[14px] leading-tight text-white">{ch.label}</span>
              {ch.desc && <span className="mt-0.5 text-[13px] leading-snug text-white/75">{ch.desc}</span>}
              {ch.disabled && <span className="text-[13px] leading-snug text-[#ffb0b0]">{ch.disabled}</span>}
              {ch.detail && <span className="mt-0.5 text-[13px] leading-none text-sky">자세히 ›</span>}
            </div>
            <button className="px-btn primary min-h-12 w-16 shrink-0 text-[14px]" data-sfx="none" data-testid="ev-select" disabled={!!ch.disabled} onClick={() => resolveEvent(i)}>
              선택
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * 대기 중인 이벤트 카드. 데스크톱(sheet=false)은 야구장 영역 위, 모바일(sheet)은 바텀 시트.
 * 접어 두고 선수단을 살펴본 뒤 액션 바에서 다시 열 수 있다.
 */
export default function EventCardModal({ sheet = false }: { sheet?: boolean }) {
  const card = useStore((s) => s.campaign.event);
  const busy = useStore((s) => !!s.playback || !!s.summary);
  const hidden = useUi((s) => s.eventHidden);
  const setHidden = useUi((s) => s.setEventHidden);
  const resolveEvent = useStore((s) => s.resolveEvent);
  // 열린 상세: 카드가 바뀌면(연속 재계약 등) 닫힌 것으로 본다
  const [open, setOpen] = useState<{ id: string; i: number } | null>(null);
  if (!card || busy || hidden === card.id) return null;
  const hide = () => setHidden(card.id);
  const idx = open && open.id === card.id && card.choices[open.i]?.detail ? open.i : null;
  const onOpen = (i: number) => setOpen({ id: card.id, i });
  const detail =
    idx !== null ? (
      <EventDetail
        card={card}
        index={idx}
        mobile={sheet}
        onClose={() => setOpen(null)}
        onNav={(i) => {
          // 상세가 없는 선택지는 건너뛴다
          const n = card.choices.length;
          const dir = (i - idx + n) % n === 1 ? 1 : -1;
          let j = i;
          for (let k = 0; k < n && !card.choices[j]?.detail; k++) j = (j + dir + n) % n;
          onOpen(j);
        }}
        onPick={(i) => {
          setOpen(null);
          resolveEvent(i);
        }}
      />
    ) : null;

  if (sheet) {
    return (
      <>
        <Sheet onClose={hide} label={card.title}>
          <CardBody card={card} onOpen={onOpen} />
        </Sheet>
        {detail}
      </>
    );
  }
  return (
    <>
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink/70 p-3" role="dialog" aria-label={card.title}>
      <div className="px-panel px-scroll anim-pop relative flex max-h-full w-full max-w-[460px] flex-col overflow-y-auto p-3">
        <button className="absolute top-1 right-1 cursor-pointer px-2 py-1 text-[11px] text-white/50" onClick={hide} aria-label="잠시 접기">
          접기 ▁
        </button>
        <CardBody card={card} onOpen={onOpen} />
      </div>
    </div>
    {detail}
    </>
  );
}

/** 접어 둔 카드를 다시 여는 버튼 (액션 바용). 대기 카드가 없으면 null */
export function EventReopen({ className = '' }: { className?: string }) {
  const card = useStore((s) => s.campaign.event);
  const hidden = useUi((s) => s.eventHidden);
  const setHidden = useUi((s) => s.setEventHidden);
  if (!card || hidden !== card.id) return null;
  return (
    <button className={`px-btn gold ${className}`} onClick={() => setHidden(null)}>
      {card.icon} {card.title}
    </button>
  );
}
