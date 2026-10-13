import { useMemo, useState, type ReactNode } from 'react';
import type { Player } from '../../game/types';
import { FIELD_KEYS, PITCH_KEYS, VALUE_FAIR, canPlay, fitsKey, scoutRoom, signImpact, statusTags, valueGap, type PosKey, type PosRow, type SignImpact } from '../../game/analysis';
import { signingBonus } from '../../game/economy';
import { fmtAvg, fmtEra, fmtMoney, fmtOps, fmtWhip } from '../../game/format';
import { era, ops, whip } from '../../game/leaders';
import { useStore, useUserTeam } from '../../store';
import { ScoutBadge } from '../PlayerCard';
import { useIsMobile } from '../layout/useLayout';
import { POS_KO, ratingColor } from '../ui';
import { PART_KO } from './labels';

export type TableMode = 'roster' | 'market' | 'draft';
type Group = 'core' | 'abil' | 'rec' | 'deal';
type Kind = 'all' | 'B' | 'P';

interface Col {
  id: string;
  label: string;
  group: Group;
  kind?: 'B' | 'P'; // 타자/투수 전용 열
  val: (p: Player) => number | string; // 정렬 값
  cell: (p: Player) => ReactNode;
  left?: boolean;
  asc?: boolean; // 처음 탭했을 때 오름차순 (ERA 처럼 낮을수록 좋은 값)
}

const SETS: [Group, string][] = [
  ['abil', '능력'],
  ['rec', '기록'],
  ['deal', '계약'],
];
const TAG_TONE = { bad: 'text-bad', warn: 'text-[#f0a35a]', good: 'text-good', hi: 'text-hi' } as const;
const SCOUT_ORDER: Record<string, number> = { A: 4, B: 3, C: 2, D: 1 };

const rate = (v: number) => <span style={{ color: ratingColor(v) }}>{v}</span>;
const dash = <span className="text-white/25">-</span>;

function Chip({ on, onClick, children, tone = 'hi', testid }: { on: boolean; onClick: () => void; children: ReactNode; tone?: 'hi' | 'bad'; testid?: string }) {
  return (
    <button
      data-sfx="tab"
      data-testid={testid}
      onClick={onClick}
      className={`shrink-0 cursor-pointer whitespace-nowrap px-1.5 py-0.5 text-[10px] mob:min-h-8 mob:px-2.5 mob:text-[12px] ${on ? (tone === 'bad' ? 'bg-bad text-ink' : 'bg-hi text-ink') : tone === 'bad' ? 'bg-ink text-bad' : 'bg-ink text-white/60'}`}
    >
      {children}
    </button>
  );
}

/**
 * 선수 표: 선수단(프런트 오피스) · 영입 시장 · 드래프트가 같이 쓴다.
 * 열 머리를 누르면 정렬, 모바일은 이름 열을 고정하고 가로로 민다.
 */
export default function PlayerTable({
  mode,
  players,
  rows,
  sel,
  onPick,
  initPos = null,
}: {
  mode: TableMode;
  players: Player[];
  rows: PosRow[]; // 팀 진단 (약점·빈 뎁스 표시용)
  sel?: string | null;
  onPick: (p: Player) => void;
  initPos?: PosKey | 'weak' | null;
}) {
  const mobile = useIsMobile();
  const team = useUserTeam();
  const season = useStore((s) => s.season);
  const analyst = useStore((s) => !!s.campaign.analyst);
  const cash = useStore((s) => s.finance.cash);
  const [kind, setKind] = useState<Kind>(initPos && initPos !== 'weak' ? (PITCH_KEYS.includes(initPos as 'SP') ? 'P' : 'B') : 'all');
  const [pos, setPos] = useState<PosKey | 'weak' | null>(initPos);
  const [set, setSet] = useState<Group>(mode === 'roster' ? 'abil' : 'deal');
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 }>({ id: mode === 'draft' ? 'scout' : 'ovr', dir: -1 });

  // 약점 = 리그 순위가 가장 낮은 2곳 / 빈 뎁스 = 백업이 리그 평균보다 크게 낮은 자리
  const weakKeys = useMemo(() => rows.filter((r) => r.weak).map((r) => r.key), [rows]);
  const thinKeys = useMemo(() => rows.filter((r) => r.thin && r.key !== 'DH').map((r) => r.key), [rows]);
  const needKeys = mode === 'draft' ? thinKeys : weakKeys;
  const needs = (p: Player) => needKeys.includes(p.pos as PosKey);
  const mine = mode === 'roster';
  const role = useMemo(() => {
    const m = new Map<string, string>();
    if (!mine) return m;
    team.lineup.forEach((l, i) => m.set(l.pid, `${i + 1}번`));
    team.rotation.forEach((id, i) => m.set(id, `${i + 1}선발`));
    team.bullpen.forEach((id, i) => m.set(id, `불펜${i + 1}`));
    if (team.closer) m.set(team.closer, '마무리');
    return m;
  }, [mine, team]);
  const impact = useMemo(() => {
    const m = new Map<string, SignImpact>();
    if (mode === 'market') for (const p of players) m.set(p.id, signImpact(team, p));
    return m;
  }, [mode, players, team]);

  const cols = useMemo((): Col[] => {
    const abil = (id: 'con' | 'pow' | 'eye' | 'spd' | 'def' | 'stf' | 'ctl' | 'sta', label: string, k: 'B' | 'P'): Col => ({
      id, label, group: 'abil', kind: k, val: (p) => (p.kind === k ? p[id] : -1), cell: (p) => (p.kind === k ? rate(p[id]) : dash),
    });
    const gapCell = (p: Player) => {
      const g = valueGap(p, season);
      if (Math.abs(g) < VALUE_FAIR) return <span className="text-white/50">적정</span>;
      return g > 0 ? <span className="text-good">저평가 +{fmtMoney(g)}</span> : <span className="text-bad">고평가 −{fmtMoney(-g)}</span>;
    };
    const out: Col[] = [
      { id: 'pos', label: '포지션', group: 'core', val: (p) => [...FIELD_KEYS, ...PITCH_KEYS].indexOf(p.pos as PosKey), cell: (p) => <span className="text-sky">{POS_KO[p.pos]}</span>, left: true, asc: true },
      { id: 'age', label: '나이', group: 'core', val: (p) => p.age, cell: (p) => p.age, asc: true },
      { id: 'ovr', label: 'OVR', group: 'core', val: (p) => p.ovr, cell: (p) => rate(p.ovr) },
    ];
    if (mode === 'draft') {
      out.push(
        { id: 'scout', label: '등급', group: 'core', val: (p) => (SCOUT_ORDER[p.scout ?? ''] ?? 0) * 100 + p.ovr, cell: (p) => <ScoutBadge grade={p.scout} size={16} /> },
        {
          id: 'room', label: '예상 여지', group: 'deal', val: (p) => scoutRoom(analyst, p).lo,
          cell: (p) => {
            const r = scoutRoom(analyst, p);
            return <span className="text-good">{r.hi === null ? `+${r.lo} 이상` : r.hi <= 0 ? '거의 없음' : `+${r.lo}~${r.hi}`}</span>;
          },
        },
        { id: 'origin', label: '출신', group: 'deal', val: (p) => p.age, cell: (p) => <span className="text-white/60">{p.tag ?? (p.age <= 20 ? '고졸' : '대졸')}</span>, left: true },
      );
    } else {
      out.push({ id: 'pot', label: '잠재', group: 'core', val: (p) => p.pot, cell: (p) => <span className={p.pot - p.ovr >= 6 ? 'text-good' : 'text-white/60'}>{p.pot}</span> });
    }
    out.push(
      abil('con', '컨택', 'B'), abil('pow', '파워', 'B'), abil('eye', '선구', 'B'), abil('spd', '주력', 'B'), abil('def', '수비', 'B'),
      abil('stf', '구위', 'P'), abil('ctl', '제구', 'P'), abil('sta', '체력', 'P'),
      {
        id: 'field', label: '수비 가능', group: 'abil', kind: 'B', val: (p) => canPlay(p).length, left: true,
        cell: (p) => (p.kind === 'B' ? <span className="text-white/65">{canPlay(p).map((x) => POS_KO[x]).join('·') || '지명'}</span> : dash),
      },
    );
    if (mode !== 'draft') {
      out.push(
        { id: 'avg', label: '타율', group: 'rec', kind: 'B', val: (p) => (p.kind === 'B' && p.bat.ab ? p.bat.h / p.bat.ab : -1), cell: (p) => (p.kind === 'B' ? fmtAvg(p.bat.h, p.bat.ab) : dash) },
        { id: 'hr', label: '홈런', group: 'rec', kind: 'B', val: (p) => (p.kind === 'B' ? p.bat.hr : -1), cell: (p) => (p.kind === 'B' ? p.bat.hr : dash) },
        { id: 'ops', label: 'OPS', group: 'rec', kind: 'B', val: (p) => (p.kind === 'B' && p.bat.pa ? ops(p) : -1), cell: (p) => (p.kind === 'B' ? (p.bat.pa > 0 ? fmtOps(ops(p)) : '.---') : dash) },
        { id: 'era', label: 'ERA', group: 'rec', kind: 'P', val: (p) => (p.kind === 'P' && p.pit.outs ? era(p) : 99), cell: (p) => (p.kind === 'P' ? fmtEra(p.pit.er, p.pit.outs) : dash), asc: true },
        { id: 'whip', label: 'WHIP', group: 'rec', kind: 'P', val: (p) => (p.kind === 'P' && p.pit.outs ? whip(p) : 99), cell: (p) => (p.kind === 'P' ? fmtWhip(p.pit.h + p.pit.bb, p.pit.outs) : dash), asc: true },
        { id: 'salary', label: '연봉', group: 'deal', val: (p) => p.salary, cell: (p) => fmtMoney(p.salary) },
        { id: 'gap', label: '가성비', group: 'deal', val: (p) => valueGap(p, season), cell: gapCell },
      );
    }
    if (mode === 'market') {
      out.push(
        { id: 'bonus', label: '계약금', group: 'deal', val: (p) => signingBonus(p), cell: (p) => <span className={cash >= signingBonus(p) ? 'text-hi' : 'text-bad'}>{fmtMoney(signingBonus(p))}</span> },
        {
          id: 'impact', label: '영입 시 전력', group: 'deal', val: (p) => impact.get(p.id)?.total ?? 0, left: true,
          cell: (p) => {
            const im = impact.get(p.id);
            const ds = Object.entries(im?.delta ?? {}) as [keyof typeof PART_KO, number][];
            if (!ds.length) return <span className="text-white/45">{im?.role ?? '-'} · 변화 없음</span>;
            return (
              <span>
                {ds.map(([k, d], i) => (
                  <span key={k} className={d > 0 ? 'text-good' : 'text-bad'}>
                    {i > 0 && <span className="text-white/40"> · </span>}
                    {PART_KO[k]} {d > 0 ? '+' : '−'}{Math.abs(d)}
                  </span>
                ))}
              </span>
            );
          },
        },
      );
    }
    out.push({
      id: 'status', label: mine ? '보직·상태' : '상태', group: 'deal', val: (p) => p.injury * 10 + (p.tired ?? 0), left: true,
      cell: (p) => {
        const tags = statusTags(p, season, mine);
        return (
          <span className="flex gap-1">
            {mine && <span className="text-white/55">{role.get(p.id) ?? (p.kind === 'B' ? '벤치' : '대기')}</span>}
            {tags.map((t) => (
              <span key={t.text} className={TAG_TONE[t.tone]}>{t.text}</span>
            ))}
            {!mine && !tags.length && <span className="text-white/30">-</span>}
          </span>
        );
      },
    });
    return out;
  }, [mode, season, analyst, cash, impact, mine, role]);

  const shown = cols.filter((c) => (kind === 'all' || !c.kind || c.kind === kind) && (!mobile || c.group === 'core' || c.group === set));
  const list = useMemo(() => {
    const c = cols.find((x) => x.id === sort.id) ?? { val: (p: Player) => p.name };
    const f = players.filter((p) => (kind === 'all' || p.kind === kind) && (pos === null || (pos === 'weak' ? needKeys.some((k) => fitsKey(p, k)) : fitsKey(p, pos))));
    return f.sort((a, b) => {
      const x = c.val(a);
      const y = c.val(b);
      return (typeof x === 'string' || typeof y === 'string' ? String(x).localeCompare(String(y), 'ko') : x < y ? -1 : x > y ? 1 : 0) * sort.dir || b.ovr - a.ovr;
    });
  }, [players, cols, sort, kind, pos, needKeys]);
  const posList: PosKey[] = kind === 'P' ? PITCH_KEYS : kind === 'B' ? FIELD_KEYS : [...FIELD_KEYS, ...PITCH_KEYS];
  const needLabel = mode === 'draft' ? '빈 뎁스만' : '우리 약점만';
  const th = 'cursor-pointer whitespace-nowrap bg-edge px-1.5 py-1 text-[10px] font-normal mob:py-2 mob:text-[11px]';

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid={`table-${mode}`}>
      <div className="flex shrink-0 flex-wrap items-center gap-1 px-1.5 pt-1.5">
        {([['all', '전체'], ['B', '타자'], ['P', '투수']] as const).map(([k, label]) => (
          <Chip key={k} on={kind === k} onClick={() => { setKind(k); if (pos !== 'weak') setPos(null); }} testid={`kind-${k}`}>
            {label}
          </Chip>
        ))}
        {mode !== 'roster' && (
          <Chip on={pos === 'weak'} tone="bad" onClick={() => setPos(pos === 'weak' ? null : 'weak')} testid="need-only">
            {needLabel}
            {needKeys.length > 0 && ` (${needKeys.map((k) => POS_KO[k]).join('·')})`}
          </Chip>
        )}
        {mobile && (
          <span className="ml-auto flex gap-1">
            {SETS.filter(([g]) => mode !== 'draft' || g !== 'rec').map(([g, label]) => (
              <Chip key={g} on={set === g} onClick={() => setSet(g)} testid={`set-${g}`}>
                {mode === 'draft' && g === 'deal' ? '평가' : label}
              </Chip>
            ))}
          </span>
        )}
      </div>
      <div className="px-scroll flex shrink-0 gap-1 overflow-x-auto px-1.5 py-1">
        <Chip on={pos === null} onClick={() => setPos(null)}>
          전 포지션
        </Chip>
        {posList.map((k) => (
          <Chip key={k} on={pos === k} onClick={() => setPos(pos === k ? null : k)} testid={`pos-${k}`}>
            {POS_KO[k]}
            {needKeys.includes(k) && <span className={pos === k ? '' : 'text-bad'}> !</span>}
          </Chip>
        ))}
      </div>
      <div className="px-scroll min-h-0 flex-1 overflow-auto" data-testid="table-scroll">
        <table className="border-separate border-spacing-0 text-[11px] mob:text-[12px]" style={{ minWidth: '100%' }}>
          <thead>
            <tr>
              <th className={`${th} sticky left-0 top-0 z-20 text-left`} onClick={() => setSort({ id: 'name', dir: 1 })}>
                이름 <span className="text-white/40">{list.length}명</span>
              </th>
              {shown.map((c) => (
                <th
                  key={c.id}
                  data-col={c.id}
                  className={`${th} sticky top-0 z-10 ${c.left ? 'text-left' : 'text-right'} ${sort.id === c.id ? 'text-hi' : 'text-white/65'}`}
                  onClick={() => setSort((s) => (s.id === c.id ? { id: c.id, dir: s.dir === 1 ? -1 : 1 } : { id: c.id, dir: c.asc ? 1 : -1 }))}
                >
                  {c.label}
                  {sort.id === c.id && (sort.dir === 1 ? ' ▲' : ' ▼')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((p, i) => {
              const bg = sel === p.id ? '#4a4a2c' : i % 2 ? '#283149' : '#232c42';
              return (
                <tr key={p.id} data-pid={p.id} className="cursor-pointer" onClick={() => onPick(p)}>
                  <td className="sticky left-0 z-[5] max-w-[150px] whitespace-nowrap px-1.5 py-1 mob:py-2" style={{ background: bg, boxShadow: 'inset -1px 0 0 #0f1420' }}>
                    <span className={`block truncate ${p.injury > 0 ? 'text-bad' : 'text-white'}`}>
                      {p.name}
                      {mode !== 'roster' && needs(p) && (
                        <span className="ml-1 bg-bad px-1 text-[9px] text-ink mob:text-[10px]" data-testid="need-badge">
                          {mode === 'draft' ? '빈 뎁스' : '약점 보강'}
                        </span>
                      )}
                    </span>
                  </td>
                  {shown.map((c) => (
                    <td key={c.id} className={`whitespace-nowrap px-1.5 py-1 mob:py-2 ${c.left ? 'text-left' : 'text-right'}`} style={{ background: bg }}>
                      {c.cell(p)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!list.length && <div className="p-3 text-center text-[11px] text-white/40">조건에 맞는 선수가 없습니다</div>}
      </div>
    </div>
  );
}
