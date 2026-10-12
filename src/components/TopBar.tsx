import type { ReactNode } from 'react';
import { useStore, useUserTeam } from '../store';
import { fmtInt, fmtMoney } from '../game/format';
import { payroll } from '../game/economy';
import { teamStrength } from '../game/ratings';
import { rankOf } from '../game/season';
import { Bar, ratingColor, recText, TeamDot } from './ui';

function Cell({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return (
    <div className="flex flex-col justify-center px-2.5 leading-tight" title={title}>
      <span className="text-[9px] text-white/50">{label}</span>
      <span className="whitespace-nowrap text-[13px]">{children}</span>
    </div>
  );
}

const Sep = () => <div className="mx-1 w-[2px] self-stretch bg-edge" />;

export default function TopBar() {
  const team = useUserTeam();
  const teams = useStore((s) => s.teams);
  const season = useStore((s) => s.season);
  const day = useStore((s) => s.day);
  const total = useStore((s) => s.schedule.length);
  const cash = useStore((s) => s.finance.cash);
  const debt = useStore((s) => s.finance.debt);
  const crowd = useStore((s) => s.crowd);
  const fans = useStore((s) => s.fans);
  const fanSat = useStore((s) => s.fanSat);

  const rank = rankOf(teams, team.id);
  const str = teamStrength(team);
  const pay = payroll(team);
  const streak = team.rec.streak;

  return (
    <div className="px-panel flex h-12 shrink-0 items-stretch px-2">
      <div className="flex items-center gap-2 pr-2">
        <TeamDot team={team} size={22} />
        <div className="leading-tight">
          <div className="font-pixel-lg text-[15px]" style={{ color: team.color, textShadow: '1px 1px 0 #0f1420' }}>
            {team.city} {team.name}
          </div>
          <div className="text-[10px] text-white/55">
            {season}시즌 · {Math.min(day, total)}/{total} 경기
          </div>
        </div>
      </div>
      <div className="flex w-24 items-center">
        <Bar ratio={total ? day / total : 0} color="#7fd3ff" h={6} />
      </div>
      <Sep />
      <Cell label="순위">
        <span className={rank <= 3 ? 'text-hi' : rank >= 7 ? 'text-bad' : ''}>{rank}위</span>
      </Cell>
      <Cell label="전적">
        {recText(team.rec)}
        {Math.abs(streak) >= 2 && (
          <span className={`ml-1 text-[10px] ${streak > 0 ? 'text-good' : 'text-bad'}`}>
            {Math.abs(streak)}
            {streak > 0 ? '연승' : '연패'}
          </span>
        )}
      </Cell>
      <Sep />
      <Cell label="현금">
        <span className={cash < 0 ? 'text-bad' : 'text-hi'}>{fmtMoney(cash)}</span>
      </Cell>
      <Cell label="부채">
        <span className={debt > 0 ? 'text-bad' : 'text-white/60'}>{fmtMoney(debt)}</span>
      </Cell>
      <Cell label="연봉 총액">{fmtMoney(pay)}</Cell>
      <Sep />
      <Cell label="최근 관중" title="마지막 홈경기 관중">
        {crowd ? (
          <>
            {fmtInt(crowd.attendance)}
            {crowd.soldOut && <span className="ml-1 text-[10px] text-hi">매진</span>}
          </>
        ) : (
          <span className="text-white/40">-</span>
        )}
      </Cell>
      <Cell label="팬 수">{fmtInt(Math.round(fans))}</Cell>
      <Cell label="만족도" title={`팬 만족도 ${Math.round(fanSat)}/100`}>
        <span className="flex items-center gap-1">
          <span style={{ color: fanSat >= 60 ? '#6ee07a' : fanSat >= 40 ? '#ffd84a' : '#ff6b6b' }}>{Math.round(fanSat)}</span>
          <span className="w-10">
            <Bar ratio={fanSat / 100} color={fanSat >= 60 ? '#6ee07a' : fanSat >= 40 ? '#ffd84a' : '#ff6b6b'} h={5} />
          </span>
        </span>
      </Cell>
      <Cell label="전력">
        <span style={{ color: ratingColor(str) }}>{Math.round(str)}</span>
      </Cell>
    </div>
  );
}
