import { useMemo, useState } from 'react';
import { useCore } from '../store';
import { batLeaders, leagueEnv, pitLeaders, type BatCat, type LeaderRow, type PitCat } from '../game/leaders';
import { fmtEra, fmtOps } from '../game/format';
import { Chips, SectionTitle, TeamDot } from './ui';

const BAT: readonly (readonly [BatCat, string])[] = [
  ['avg', '타율'],
  ['hr', '홈런'],
  ['rbi', '타점'],
  ['ops', 'OPS'],
  ['sb', '도루'],
  ['h', '안타'],
  ['r', '득점'],
];
const PIT: readonly (readonly [PitCat, string])[] = [
  ['era', '평균자책점'],
  ['w', '다승'],
  ['sv', '세이브'],
  ['so', '탈삼진'],
  ['whip', 'WHIP'],
];

function Board({ rows, empty }: { rows: LeaderRow[]; empty: string }) {
  const core = useCore();
  const byId = useMemo(() => new Map(core.teams.map((t) => [t.id, t])), [core.teams]);
  if (!rows.length) return <div className="px-1 py-1 text-[10px] text-white/40">{empty}</div>;
  return (
    <>
      {rows.map((r, i) => {
        const me = r.teamId === core.userId;
        const t = byId.get(r.teamId);
        return (
          <div
            key={r.pid}
            className={`flex items-center gap-1.5 px-1 py-[3px] text-[11px] mob:min-h-10 mob:text-[13px] ${me ? 'bg-hi/20 text-hi' : i % 2 ? 'bg-white/4' : ''}`}
            style={me ? { boxShadow: 'inset 2px 0 0 #ffd84a' } : undefined}
          >
            <span className={`w-4 shrink-0 ${i === 0 ? 'text-hi' : 'text-white/50'}`}>{i + 1}</span>
            <TeamDot team={t} />
            <span className="min-w-0 flex-1 truncate">
              {r.name} <span className="text-[10px] text-white/45">{t?.name}</span>
            </span>
            <span className="font-pixel-lg shrink-0 text-[13px]">{r.text}</span>
          </div>
        );
      })}
    </>
  );
}

function Env({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center bg-ink/60 px-1 py-0.5">
      <span className="text-[9px] text-white/50">{label}</span>
      <span className="text-[12px] leading-tight">{value}</span>
    </div>
  );
}

/** 리그 기록: 카테고리 칩 + 상위 5명 + 리그 평균 */
export default function Leaders() {
  const core = useCore();
  const [bat, setBat] = useState<BatCat>('avg');
  const [pit, setPit] = useState<PitCat>('era');
  const batRows = useMemo(() => batLeaders(core, bat, 5), [core, bat]);
  const pitRows = useMemo(() => pitLeaders(core, pit, 5), [core, pit]);
  const env = useMemo(() => leagueEnv(core), [core]);
  const played = core.teams.some((t) => t.rec.w + t.rec.l + t.rec.t > 0);
  const empty = played ? '규정 타석·이닝을 채운 선수가 아직 없습니다' : '개막 전입니다';

  return (
    <>
      <SectionTitle>타격</SectionTitle>
      <Chips items={BAT} value={bat} onChange={setBat} />
      <div className="mt-1">
        <Board rows={batRows} empty={empty} />
      </div>

      <SectionTitle>투수</SectionTitle>
      <Chips items={PIT} value={pit} onChange={setPit} />
      <div className="mt-1">
        <Board rows={pitRows} empty={empty} />
      </div>

      <SectionTitle>리그 평균</SectionTitle>
      {played ? (
        <div className="grid grid-cols-4 gap-[2px]">
          <Env label="타율" value={fmtOps(env.avg)} />
          <Env label="출루율" value={fmtOps(env.obp)} />
          <Env label="장타율" value={fmtOps(env.slg)} />
          <Env label="OPS" value={fmtOps(env.obp + env.slg)} />
          <Env label="평균자책점" value={fmtEra(env.era, 27)} />
          <Env label="경기당 득점" value={env.rpg.toFixed(2)} />
          <Env label="경기당 홈런" value={env.hrPerGame.toFixed(2)} />
          <Env label="경기당 도루" value={env.sbPerGame.toFixed(2)} />
        </div>
      ) : (
        <div className="px-1 text-[10px] text-white/40">{empty}</div>
      )}
    </>
  );
}
