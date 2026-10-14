import { useMemo, useState } from 'react';
import type { Core } from '../game/types';
import { GM_MAX, RANKS } from '../game/gmscore';
import { TRUST_LABEL } from '../game/story';
import { cardOf } from '../share/shareData';

const PART_KO = [
  ['s', '성적', '최종 순위 220 · 시작 대비 순위 상승(한 계단 25, 최대 100) · 가을야구 130 (WC 40 → 준PO 60 → PO 85 → KS 110 → 우승 130)'],
  ['p', '살림', '영업 손익 120 (0원 = 60, ±20억이면 끝) · 부채 증감 60 · 관중 점유율 60 + 매진 20 · 경쟁균형세 안 냄 20 · 빚더미 여론 피함 20'],
  ['m', '민심', `시즌 말 ${TRUST_LABEL} 150 · 깃발 달성 60 · 별 한 개 20 (최대 40)`],
] as const;

/** 시즌 결산 맨 위 한 줄: "단장 A · 명단장 · 742점" + [?] 도움말 (세 갈래 막대와 계산식) */
export default function GmRankLine({ core }: { core: Core }) {
  const gm = useMemo(() => cardOf(core, 'season').gm, [core]);
  const [open, setOpen] = useState(false);
  if (!gm) return null;
  const color = RANKS.find((r) => r.id === gm.id)?.color ?? '#fff';
  const nth = core.campaign.history.length;
  return (
    <div className="mb-2" data-testid="gm-rank">
      <div className="flex items-center gap-2">
        <span className="font-pixel-lg flex h-8 min-w-10 items-center justify-center px-1.5 text-[18px] text-ink" style={{ background: color, boxShadow: '0 0 0 2px #0f1420' }}>
          {gm.id}
        </span>
        <span className="font-pixel-lg min-w-0 flex-1 truncate text-[16px] mob:text-[15px]">
          단장 {gm.id} · <span style={{ color }}>{gm.name}</span> · {gm.score}점
        </span>
        <button type="button" className="px-btn flex h-8 w-8 shrink-0 items-center justify-center !p-0 mob:h-10 mob:w-10" aria-label="단장 점수 도움말" aria-expanded={open} data-testid="gm-help" onClick={() => setOpen(!open)}>
          ?
        </button>
      </div>
      {open && gm.parts && (
        <div className="mt-1.5 bg-ink/60 px-2 py-2 text-[12px] leading-snug mob:text-[13px]" data-testid="gm-help-body">
          {PART_KO.map(([k, label, how]) => {
            const v = gm.parts![k];
            const max = GM_MAX[k];
            return (
              <div key={k} className="mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-9 shrink-0 text-sky">{label}</span>
                  <div className="h-3 min-w-0 flex-1 bg-white/10">
                    <div className="h-full bg-hi" style={{ width: `${Math.round((v / max) * 100)}%` }} />
                  </div>
                  <span className="w-[70px] shrink-0 text-right">
                    {v} / {max}
                  </span>
                </div>
                <div className="pl-11 text-white/55">{how}</div>
              </div>
            );
          })}
          <div className="mt-1 text-white/60">
            랭크는 가상 단장들의 {nth >= 6 ? '6시즌째 이후' : `${nth}시즌째`} 점수 분포로 정합니다: {RANKS.map((r) => `${r.id} ${r.pct}%`).join(' · ')}
          </div>
        </div>
      )}
    </div>
  );
}
