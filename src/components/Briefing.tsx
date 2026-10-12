import { useEffect } from 'react';
import { play } from '../audio/sfx';
import type { BriefOffer } from '../game/types';
import { flagForecast } from '../game/campaign';
import { CHARACTERS } from '../game/story';
import { useCore, useStore, useUserTeam } from '../store';
import { Flag } from './Campaign';
import PixelFace from './PixelFace';
import { useIsMobile } from './layout/useLayout';
import { useUi, type TipId } from './layout/uiStore';

const safe = {
  paddingTop: 'max(env(safe-area-inset-top), 4px)',
  paddingBottom: 'max(env(safe-area-inset-bottom), 6px)',
  paddingLeft: 'max(env(safe-area-inset-left), 4px)',
  paddingRight: 'max(env(safe-area-inset-right), 4px)',
};

/** 깃발 예측 한 줄: "지금 페이스: 6위 예상 · 깃발 7위 이내 ✓" (12경기 전에는 "—") */
export function FlagForecast({ className = '' }: { className?: string }) {
  const core = useCore();
  const f = flagForecast(core);
  return (
    <div className={`flex items-start gap-1.5 text-[12px] leading-snug mob:text-[13px] ${className}`} data-testid="flag-forecast">
      <span className="mt-[2px] shrink-0">
        <Flag size={11} color={f.ok ? '#6ee07a' : '#ffd84a'} />
      </span>
      <span className={f.text === '—' ? 'text-white/50' : f.ok ? 'text-good' : 'text-white/85'}>{f.text === '—' ? '깃발 예측 — (12경기 뒤부터)' : f.text}</span>
    </div>
  );
}

/** 스태프 제안 한 장: 초상 + 한 줄 + 예상 결과 숫자 + [실행] 한 번 탭 / 넘기기 */
function OfferCard({ o }: { o: BriefOffer }) {
  const team = useUserTeam();
  const run = useStore((s) => s.briefRun);
  const skip = useStore((s) => s.briefSkip);
  const ch = CHARACTERS[o.who];
  const done = o.state === 'done';
  const skipped = o.state === 'skipped';
  return (
    <div className={`bg-ink/55 p-2 ${skipped ? 'opacity-50' : ''}`} style={{ boxShadow: done ? 'inset 3px 0 0 #6ee07a' : 'inset 3px 0 0 #ffd84a' }} data-testid="brief-offer" data-offer={o.id} data-state={o.state ?? 'open'}>
      <div className="flex items-start gap-2">
        <div className="shrink-0" style={{ boxShadow: `0 0 0 2px #0f1420, 0 0 0 3px ${team.color2}` }}>
          <PixelFace id={`char-${ch.seed}`} color={team.color} color2={team.color2} size={44} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] leading-tight mob:text-[13px]">
            {ch.name} <span className="text-[11px] text-white/55">{ch.title}</span>
          </div>
          <div className="mt-0.5 text-[12px] leading-snug text-white/85 mob:text-[13px]">“{o.line}”</div>
        </div>
      </div>
      <div className="mt-1.5 text-[12px] leading-snug text-hi mob:text-[13px]" data-testid="brief-effect">
        {o.effect}
        {o.flag && <span className="text-good"> · {o.flag}</span>}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        {done ? (
          <span className="text-[12px] text-good mob:text-[13px]">✓ 실행했습니다 — 결과는 다음 주 브리핑에</span>
        ) : skipped ? (
          <span className="text-[12px] text-white/60 mob:text-[13px]">넘겼습니다</span>
        ) : (
          <>
            <button className="px-btn primary min-h-10 flex-[2] text-[14px]" data-testid="brief-run" onClick={() => run(o.id)}>
              실행
            </button>
            <button className="px-btn min-h-10 flex-1 text-[12px] mob:text-[13px]" data-testid="brief-skip" onClick={() => skip(o.id)}>
              넘기기
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * 주간 브리핑: 정규시즌 6경기마다 결정이 유저에게 온다. 이벤트 카드·경기 요약이 먼저고, 닫아야 다음 경기를 치른다.
 * 모바일은 전체 화면, 데스크톱은 중앙 모달.
 */
export default function BriefingSheet() {
  const b = useStore((s) => s.campaign.briefing);
  const show = useStore((s) => !!s.campaign.briefing && !s.campaign.event && !s.summary && !s.playback && s.phase === 'season');
  const close = useStore((s) => s.briefClose);
  const mobile = useIsMobile();
  useEffect(() => {
    if (show) play('event');
  }, [show]);
  if (!b || !show) return null;
  const open = b.offers.filter((o) => !o.state).length;

  const body = (
    <>
      <div className="flex shrink-0 items-baseline gap-2 px-2 pt-1.5">
        <span className="font-pixel-lg text-[18px] leading-tight text-hi" style={{ textShadow: '1px 1px 0 #0f1420' }}>
          주간 브리핑
        </span>
        <span className="text-[11px] text-white/55 mob:text-[12px]">
          {b.day - 5}~{b.day}차전
        </span>
      </div>
      <div className="px-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pt-2 pb-1">
        {b.results.map((r) => (
          <div key={r} className="bg-good/15 px-2 py-1.5 text-[12px] leading-snug text-white mob:text-[13px]" style={{ boxShadow: 'inset 3px 0 0 #6ee07a' }} data-testid="brief-result">
            {r}
          </div>
        ))}
        <div className="bg-ink/55 px-2 py-1.5">
          <div className="text-[11px] text-white/55">지난 6경기</div>
          <div className="text-[13px] leading-snug mob:text-[14px]" data-testid="brief-summary">
            {b.summary}
          </div>
          <FlagForecast className="mt-1" />
        </div>
        {b.offers.map((o) => (
          <OfferCard key={o.id} o={o} />
        ))}
      </div>
      <div className="shrink-0 px-2 pt-1.5 pb-2">
        <button className="px-btn primary min-h-11 w-full text-[15px]" data-testid="brief-close" onClick={close}>
          {open > 0 ? `남은 제안 ${open}장 넘기고 닫기` : '닫기'}
        </button>
      </div>
    </>
  );

  if (mobile) {
    return (
      <div className="anim-fade fixed inset-0 z-[36] flex h-[100dvh] flex-col bg-panel font-pixel text-[12px] select-none" style={safe} role="dialog" aria-label="주간 브리핑" data-testid="briefing">
        {body}
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-[36] flex items-center justify-center bg-ink/70 p-3 font-pixel text-[12px] select-none" role="dialog" aria-label="주간 브리핑" data-testid="briefing">
      <div className="px-panel anim-pop flex max-h-[min(720px,100%)] w-full max-w-[520px] flex-col">{body}</div>
    </div>
  );
}

const TIP_TEXT: Record<TipId, string> = {
  market: '좋은 선수를 데려오면 전력이 오르고, 연봉이 나갑니다.',
  stadium: '표값을 올리면 경기당 수입이 늘고 관중이 줍니다. 자리가 모자라면 증축.',
  finance: '대출은 당장 쓸 돈을 주고, 시즌 내내 이자를 가져갑니다.',
};

/** 탭별 첫 만남 한 문장: 처음 열 때 한 번만, × 로 닫으면 다시 뜨지 않는다 */
export function FirstTip({ id }: { id: TipId }) {
  const seen = useUi((s) => !!s.tips[id]);
  const closeTip = useUi((s) => s.closeTip);
  if (seen) return null;
  return (
    <div className="mx-1.5 mt-1.5 flex shrink-0 items-start gap-1 bg-sky/15 py-1 pr-0.5 pl-2 text-[12px] leading-snug text-white mob:text-[13px]" style={{ boxShadow: 'inset 2px 0 0 #7fd0ff' }} data-testid={`tip-${id}`}>
      <span className="min-w-0 flex-1 py-0.5">{TIP_TEXT[id]}</span>
      <button className="shrink-0 cursor-pointer px-2 py-0.5 text-[14px] text-white/70 mob:min-h-8 mob:min-w-8" aria-label="닫기" onClick={() => closeTip(id)}>
        ×
      </button>
    </div>
  );
}
