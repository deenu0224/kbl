// 내년 살림 미리보기 (game/payforecast.ts): 결산 화면의 블록과 시즌 후반 재무 탭의 한 줄
import Fold from './Fold';
import { useMemo } from 'react';
import type { Core } from '../game/types';
import { nextSeasonForecast, payParts, raiseWhyText, signedMoney } from '../game/payforecast';
import { fmtMoney } from '../game/format';
import { useStore } from '../store';
import { openDesk } from './roster/transferUi';
import Help from './Help';

/** 결산 화면: 연봉 총액 예상과 이유별 증감 · 내년 영업손익 예상 · 가장 많이 오르는 3명 · 적자면 조합장 한 줄과 [이적 시장(방출 후보순)] */
export function PayForecastBlock({ core }: { core: Core }) {
  const stoveCards = useStore((s) => s.stoveCards);
  const f = useMemo(() => nextSeasonForecast(core), [core]);
  const diff = f.next.total - f.now.total;
  const loss = f.profit < 0;
  const parts = payParts(f);
  const head = (
    <div className="flex items-start gap-1">
      <div className="min-w-0 flex-1">
        연봉 총액 예상 <span className="text-hi">{fmtMoney(f.next.total)}</span> <span className={diff > 0 ? 'text-bad' : 'text-good'}>({signedMoney(diff)})</span>
        <span className="text-white/45"> · </span>
        내년 영업손익 예상 <span className={loss ? 'text-bad' : 'text-good'}>{signedMoney(f.profit)}</span>
      </div>
      <Help topic="payNext" />
    </div>
  );
  return (
    <div className={`mt-3 break-keep px-2 py-2 text-[12px] leading-snug mob:text-[13px] ${loss ? 'bg-bad/10' : 'bg-ink/60'}`} data-testid="pay-forecast">
      <div className="mb-1 text-[11px] text-sky">▸ 내년 살림 미리보기</div>
      {head}
      {loss && (
        <>
          {f.lux && f.lux.tax > 0 && (
            <div className="mt-0.5 text-bad">
              경쟁균형세 상한 {fmtMoney(f.lux.cap)} 초과 — 제재금 {fmtMoney(f.lux.tax)} 예상
            </div>
          )}
          {f.top.length > 0 && (
            <div className="mt-1 flex flex-col gap-[2px]" data-testid="pay-top">
              {f.top.map((r) => (
                <div key={r.pid} className="flex items-baseline gap-1.5 bg-white/4 px-1.5 py-0.5">
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <span className="shrink-0 text-white/70">
                    {fmtMoney(r.now)} → <span className="text-hi">{fmtMoney(r.next)}</span>
                  </span>
                  <span className="w-[8.5em] shrink-0 text-right text-[11px] text-white/50 mob:text-[12px]">{raiseWhyText(core, r)}</span>
                </div>
              ))}
            </div>
          )}
          {/* 이유별 증감·2군·수입·FA 는 접어 둔다 (글이 많으면 안 읽는다) */}
          <Fold label="자세히" className="mt-1">
            <div className="text-white/65">
                {parts.length > 0 && <div className="mt-0.5 text-white/65">{parts.join(' · ')}</div>}
                <div className="mt-0.5 text-white/65">
                  2군 {f.farmN.now}명 → {f.farmN.next}명 · 수입 {fmtMoney(f.income)} (이번 시즌 그대로) · 유지·운영 {fmtMoney(f.upkeep)}
                  {f.interest > 0 && ` · 이자 ${fmtMoney(f.interest)}`}
                </div>
                {f.fa.n > 0 && (
                  <div className="mt-0.5 text-white/65">
                    FA 자격 {f.fa.n}명 — 재계약하면 위 예상 그대로, 보내면 연봉 총액 −{fmtMoney(f.fa.salary)}
                  </div>
                )}
            </div>
          </Fold>
          <div className="mt-1.5 flex justify-end">
            <button
              className="px-btn min-h-11 shrink-0 whitespace-nowrap"
              data-testid="pay-release"
              onClick={() => {
                if (!stoveCards()) openDesk({ side: 'squad', sort: 'release' });
              }}
            >
              이적 시장 (방출 후보순)
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** 시즌 후반 재무 탭의 한 줄: "내년 연봉 예상 +9.7억 · 이대로면 내년 적자 −7억" */
export function PayForecastLine({ core }: { core: Core }) {
  const f = useMemo(() => nextSeasonForecast(core), [core]);
  const diff = f.next.total - f.now.total;
  const loss = f.profit < 0;
  return (
    <div className="flex items-start gap-1 break-keep text-[11px] leading-snug mob:text-[13px]" data-testid="pay-forecast-line">
      <span className="min-w-0 flex-1 text-white/75">
        내년 연봉 예상 <span className={diff > 0 ? 'text-bad' : 'text-good'}>{signedMoney(diff)}</span>
        {' · '}
        {loss ? (
          <>
            이대로면 내년 적자 <span className="text-bad">{signedMoney(f.profit)}</span>
          </>
        ) : (
          <>
            이대로면 내년 흑자 <span className="text-good">{signedMoney(f.profit)}</span>
          </>
        )}
      </span>
      <Help topic="payNext" />
    </div>
  );
}
