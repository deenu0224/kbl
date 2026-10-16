// 명예의 전당 상세: 역대 구단·기록·선수 줄을 누르면 그 구단의 시즌별 기록을 연다 (기록·선수에서 열면 그 시즌을 강조)
import type { PostFinish } from '../game/types';
import { HOF_END_KO, type HofClub, type HofSeason } from '../game/hof';
import { fmtInt, fmtMoney } from '../game/format';
import { TEAM_DEFS, USER_ID } from '../game/generate';
import { stageLabel } from './Campaign';

const DEF = TEAM_DEFS.find((d) => d.id === USER_ID)!;
const POST_KO: Record<PostFinish, string> = { none: '', WC: '와일드카드', SPO: '준플레이오프', PO: '플레이오프', KS: '한국시리즈 준우승', champion: '한국시리즈 우승' };
const signed = (v: number) => (v > 0 ? `+${fmtMoney(v)}` : v < 0 ? `−${fmtMoney(-v)}` : '0');

export function HofDetail({ club, gen, season, onClose }: { club: HofClub; gen?: number; season?: number; onClose: () => void }) {
  const facts = [
    club.star ? `간판스타 ${club.star}` : '',
    club.retired?.length ? `영구결번 ${club.retired.join(' · ')}` : '',
    club.seats ? `구장 ${club.seats}` : '',
    club.trust !== undefined ? `도민 지지 ${club.trust}` : '',
  ].filter(Boolean);
  // 시즌 줄: 새 기록은 hist, 옛 기록은 순위만
  const rows: (Pick<HofSeason, 's' | 'r'> & { full?: HofSeason })[] = club.hist ? club.hist.map((h) => ({ s: h.s, r: h.r, full: h })) : club.ranks.map((r, i) => ({ s: i + 1, r }));
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 mob:items-stretch mob:bg-ink" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }} onClick={onClose} data-testid="hof-detail">
      <div className="flex max-h-[85%] w-full max-w-[560px] flex-col bg-[#141a29] px-3 py-2 mob:max-h-full" style={{ boxShadow: '0 0 0 2px #0f1420' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between gap-2">
          <span className="font-pixel-lg truncate text-[17px]" style={{ color: DEF.color }}>
            {DEF.city} {club.nick}
            {gen !== undefined && <span className="ml-1 text-[13px] text-white/60">{gen}기</span>}
          </span>
          <button className="px-btn min-h-11 shrink-0 px-4 text-[14px]" onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="shrink-0 text-white/75">
          {club.seasons}시즌 · {stageLabel(club.stage)} · 우승 {club.titles}회 · <span className={club.end === 'champion' ? 'text-hi' : club.end === 'relocated' ? 'text-bad' : ''}>{HOF_END_KO[club.end]}</span>
        </div>
        {facts.length > 0 && <div className="shrink-0 text-white/55">{facts.join(' · ')}</div>}
        <div className="px-scroll mt-2 min-h-0 flex-1 overflow-y-auto">
          {rows.map((h) => {
            const full = h.full;
            const on = season === h.s;
            return (
              <div key={h.s} className={`mb-[2px] px-2 py-1 ${on ? 'bg-hi/15' : 'bg-panel'}`} style={on ? { boxShadow: 'inset 0 0 0 1px #ffd84a' } : undefined} data-testid="hof-season">
                <div className="flex items-baseline gap-2">
                  <span className="w-[3.6em] shrink-0 text-white/50">{h.s}시즌</span>
                  <span className="min-w-0 flex-1 truncate">
                    {h.r}위{full && ` · ${full.w}승 ${full.l}패${full.t ? ` ${full.t}무` : ''}`}
                  </span>
                  {full && full.post !== 'none' && <span className={`shrink-0 ${full.post === 'champion' ? 'text-hi' : 'text-sky'}`}>{POST_KO[full.post]}</span>}
                </div>
                {full && (
                  <div className="flex flex-wrap gap-x-2 pl-[4.1em] text-white/50">
                    <span className="shrink-0">
                      관중 {fmtInt(full.att)} · 손익 <span className={full.profit < 0 ? 'text-bad/80' : ''}>{signed(full.profit)}</span>
                    </span>
                    {full.name && <span className="ml-auto shrink-0 text-white/60">{full.name}</span>}
                  </div>
                )}
              </div>
            );
          })}
          {!club.hist && <div className="mt-1 text-white/40">이 구단은 순위만 남아 있습니다</div>}
        </div>
      </div>
    </div>
  );
}
