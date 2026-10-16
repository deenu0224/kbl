import { useState } from 'react';
import type { Exposure } from '../game/types';
import { exposureRows, exposureWhat } from '../game/scandal';
import { CHARACTERS, SCANDAL_NEWS } from '../game/story';

/** 결산 전 장면: 덮은 일이 드러났다 — 리그 사무국 긴급 발표 (여러 건이면 차례로 넘긴다). 효과음은 useSfx 의 결산 소리 */
export default function ExposureScene({ list, onDone }: { list: Exposure[]; onDone: () => void }) {
  const [i, setI] = useState(0);
  const ex = list[Math.min(i, list.length - 1)];
  const last = i >= list.length - 1;
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/95 p-4 mob:items-stretch mob:p-0"
      style={{ paddingTop: 'max(var(--sat), 0px)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      data-testid="exposure-scene"
    >
      <div className="px-scroll flex max-h-full w-full max-w-[560px] flex-col overflow-y-auto bg-[#140b0e] p-5 mob:max-w-none mob:p-4" style={{ boxShadow: '0 0 0 2px #ff6b6b, 0 0 40px rgba(255,107,107,0.25)' }}>
        <div className="flex items-center justify-between text-[12px] tracking-widest text-bad mob:text-[13px]">
          <span>■ 리그 사무국 긴급 발표</span>
          {list.length > 1 && (
            <span className="text-white/50" data-testid="exposure-page">
              {i + 1} / {list.length}
            </span>
          )}
        </div>
        <div key={i} className="anim-fade">
          <h2 className="mt-4 text-[20px] leading-snug text-white mob:text-[19px]">
            {exposureWhat(ex)} 사실이 드러났습니다
          </h2>
          <p className="mt-1 text-[13px] text-white/60 mob:text-[14px]">구단은 알고도 덮었다 — 오늘 아침 모든 신문의 1면입니다.</p>
          <div className="mt-4 flex flex-col gap-[3px]" data-testid="exposure-rows">
            {exposureRows(ex).map((r, k) => (
              <div key={k} className="flex items-center justify-between gap-3 bg-bad/10 px-3 py-2 text-[14px] mob:text-[15px]" style={{ boxShadow: 'inset 3px 0 0 #ff6b6b' }}>
                <span className="min-w-0 text-white/75">{r.label}</span>
                <span className="shrink-0 text-right tabular-nums">
                  {r.from !== undefined && <span className="text-white/50">{r.from} → </span>}
                  <span className="text-bad">{r.to}</span>
                </span>
              </div>
            ))}
          </div>
          {ex.tainted && <div className="mt-3 bg-white/5 px-3 py-2 text-[13px] text-hi mob:text-[14px]">★ {SCANDAL_NEWS.tainted} — 그해 우승에 별표가 붙습니다</div>}
          <div className="mt-4 text-[13px] leading-snug text-white/70 mob:text-[14px]">
            {CHARACTERS.chair.name} {CHARACTERS.chair.title} — “{SCANDAL_NEWS.chairExposed}”
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <button className="px-btn primary min-h-11 !px-6 text-[15px]" data-testid="exposure-next" onClick={() => (last ? onDone() : setI(i + 1))}>
            {last ? '결산으로 ▶' : '다음 발표 ▶'}
          </button>
        </div>
      </div>
    </div>
  );
}
