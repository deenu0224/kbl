import { useState } from "react";
import type { EventCard, Player } from "../game/types";
import { findPlayer, useStore } from "../store";
import PlayerCard from "./PlayerCard";
import Sheet from "./layout/Sheet";
import { Bar, OvrBadge, POS_KO, ratingColor } from "./ui";

const B_STATS: [keyof Player, string][] = [
  ["ovr", "종합"],
  ["con", "컨택"],
  ["pow", "파워"],
  ["eye", "선구"],
  ["spd", "주력"],
  ["def", "수비"],
  ["pot", "잠재"],
];
const P_STATS: [keyof Player, string][] = [
  ["ovr", "종합"],
  ["stf", "구위"],
  ["ctl", "제구"],
  ["sta", "체력"],
  ["pot", "잠재"],
];
const TONE = { good: "text-good", bad: "text-bad", info: "text-white" };

/** 두 선수의 능력치를 나란히 (왼쪽 a, 오른쪽 b, 가운데 차이) */
function Compare({ a, b }: { a: Player; b: Player }) {
  const cell = (v: number, right: boolean) => (
    <div
      className={`flex min-w-0 flex-1 items-center gap-1.5 ${right ? "flex-row-reverse" : ""}`}
    >
      <span
        className="w-6 shrink-0 text-center"
        style={{ color: ratingColor(v) }}
      >
        {v}
      </span>
      <Bar ratio={(v - 15) / 85} color={ratingColor(v)} h={7} />
    </div>
  );
  return (
    <div className="bg-ink/55 p-2" data-testid="ev-compare">
      <div className="mb-1 flex items-center text-[13px]">
        <span className="min-w-0 flex-1 truncate text-white">{a.name}</span>
        <span className="w-16 shrink-0 text-center text-[12px] text-sky">
          비교
        </span>
        <span className="min-w-0 flex-1 truncate text-right text-white">
          {b.name}
        </span>
      </div>
      <div className="mb-1 flex items-center text-[12px] text-white/60">
        <span className="flex-1">
          {POS_KO[a.pos]} · {a.age}세
        </span>
        <span className="flex-1 text-right">
          {POS_KO[b.pos]} · {b.age}세
        </span>
      </div>
      <div className="flex flex-col gap-1 text-[13px] leading-none">
        {(a.kind === "B" && b.kind === "B"
          ? B_STATS
          : a.kind === "P" && b.kind === "P"
            ? P_STATS
            : B_STATS.filter(([k]) => k === "ovr" || k === "pot")
        ).map(([k, label]) => {
          const va = a[k] as number;
          const vb = b[k] as number;
          return (
            <div key={k} className="flex items-center gap-1">
              {cell(va, false)}
              <span className="w-16 shrink-0 text-center text-[12px] text-white/60">
                {label}{" "}
                <span
                  className={
                    va > vb
                      ? "text-good"
                      : va < vb
                        ? "text-bad"
                        : "text-white/45"
                  }
                >
                  {va === vb
                    ? "="
                    : `${va > vb ? "+" : "−"}${Math.abs(va - vb)}`}
                </span>
              </span>
              {cell(vb, true)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 사건 카드 선택지의 상세: 전 → 후 표, 위험·지속, 관련 선수, 비교. 하단 [이 선택으로]/[닫기], ‹ › 로 다른 선택지.
 * 모바일은 바텀 시트, 데스크톱은 모달.
 */
export default function EventDetail({
  card,
  index,
  mobile,
  onClose,
  onNav,
  onPick,
}: {
  card: EventCard;
  index: number;
  mobile: boolean;
  onClose: () => void;
  onNav: (i: number) => void;
  onPick: (i: number) => void;
}) {
  const teams = useStore((s) => s.teams);
  const freeAgents = useStore((s) => s.freeAgents);
  const userId = useStore((s) => s.userId);
  const [view, setView] = useState<string | null>(null);
  const ch = card.choices[index];
  const d = ch?.detail;
  if (!ch || !d) return null;
  const team = teams.find((t) => t.id === userId);
  const get = (pid?: string) => findPlayer({ teams, freeAgents }, pid);
  const pids = (d.pids ?? []).map(get).filter((p): p is Player => !!p);
  const cmp = d.compare ? [get(d.compare[0]), get(d.compare[1])] : [];
  const shown = get(view ?? undefined);
  const n = card.choices.length;
  const hasBefore = d.rows.some((r) => r.before !== undefined);
  const nav = (i: number) => {
    setView(null);
    onNav((i + n) % n);
  };

  const body = (
    <div
      className="flex flex-col gap-2 font-pixel select-none"
      data-testid="ev-detail"
    >
      <div className="flex items-center gap-1.5">
        {n > 1 && (
          <button
            className="px-btn !min-h-12 w-11 shrink-0 text-[18px]"
            aria-label="이전 선택지"
            data-testid="ev-prev"
            onClick={() => nav(index - 1)}
          >
            ‹
          </button>
        )}
        <div className="min-w-0 flex-1 text-center">
          <div className="text-[12px] text-white/55">
            {card.icon} {card.title} · 선택 {index + 1}/{n}
          </div>
          <div
            className="font-pixel-lg text-[17px] leading-tight text-hi"
            style={{ textShadow: "1px 1px 0 #0f1420" }}
          >
            {ch.label}
          </div>
        </div>
        {n > 1 && (
          <button
            className="px-btn !min-h-12 w-11 shrink-0 text-[18px]"
            aria-label="다음 선택지"
            data-testid="ev-next"
            onClick={() => nav(index + 1)}
          >
            ›
          </button>
        )}
      </div>

      <div className="bg-ink/55 p-2" data-testid="ev-rows">
        <div className="mb-1 flex text-[12px] text-sky">
          <span className="flex-1">▸ 바뀌는 것</span>
          {hasBefore && (
            <span className="w-[30%] text-right text-white/50">지금</span>
          )}
          <span
            className={`${hasBefore ? "w-[38%]" : "w-[60%]"} text-right text-white/50`}
          >
            선택 후
          </span>
        </div>
        {d.rows.map((r, i) => (
          <div
            key={i}
            className="flex items-baseline gap-1 border-t border-white/5 py-1 text-[13px] leading-snug"
          >
            <span className="min-w-0 flex-1 text-white/75">{r.label}</span>
            {hasBefore && (
              <span className="w-[30%] text-right text-white/60">
                {r.before ?? ""}
              </span>
            )}
            <span
              className={`${hasBefore ? "w-[38%]" : "w-[60%]"} text-right ${TONE[r.tone ?? "info"]}`}
            >
              {r.after}
            </span>
          </div>
        ))}
      </div>

      {(d.risk || d.lasts) && (
        <div className="flex flex-col gap-1 text-[13px] leading-snug">
          {d.risk && (
            <div
              className="bg-bad/15 px-2 py-1.5"
              style={{ boxShadow: "inset 3px 0 0 #ff6b6b" }}
              data-testid="ev-risk"
            >
              <span className="text-bad">위험</span> {d.risk}
            </div>
          )}
          {d.lasts && (
            <div
              className="bg-ink/55 px-2 py-1.5"
              style={{ boxShadow: "inset 3px 0 0 #7fd3ff" }}
              data-testid="ev-lasts"
            >
              <span className="text-sky">지속</span> {d.lasts}
            </div>
          )}
        </div>
      )}

      {cmp[0] && cmp[1] && <Compare a={cmp[0]} b={cmp[1]} />}

      {pids.length > 0 && (
        <div data-testid="ev-pids">
          <div className="mb-1 text-[12px] text-sky">
            ▸ 관련 선수 (누르면 카드)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {pids.map((p) => (
              <button
                key={p.id}
                className={`px-btn flex !min-h-12 items-center gap-1.5 !px-2 text-[13px] ${view === p.id ? "gold" : ""}`}
                data-testid="ev-pid"
                onClick={() => setView(view === p.id ? null : p.id)}
              >
                <OvrBadge ovr={p.ovr} size={24} />
                {p.name}
                <span className="text-[12px] text-white/55">
                  {POS_KO[p.pos]}
                </span>
              </button>
            ))}
          </div>
          {shown && (
            <div className="mt-1.5" data-testid="ev-player">
              <PlayerCard
                player={shown}
                team={
                  team?.roster.some((x) => x.id === shown.id) ? team : undefined
                }
              />
            </div>
          )}
        </div>
      )}

      {ch.disabled && (
        <div className="text-[13px] text-[#ffb0b0]">{ch.disabled}</div>
      )}
      <div className="sticky -bottom-3 flex items-center gap-2 bg-panel pt-1.5 pb-3">
        <button
          className="px-btn primary !min-h-12 flex-[2] text-[15px]"
          data-testid="ev-pick"
          data-sfx="none"
          disabled={!!ch.disabled}
          onClick={() => onPick(index)}
        >
          이 선택으로
        </button>
        <button
          className="px-btn !min-h-12 flex-1 text-[14px]"
          data-testid="ev-close"
          onClick={onClose}
        >
          닫기
        </button>
      </div>
    </div>
  );

  if (mobile) {
    return (
      <Sheet onClose={onClose} label={`${card.title} — ${ch.label}`}>
        {body}
      </Sheet>
    );
  }
  return (
    <div
      className="fixed inset-0 z-[45] flex items-center justify-center bg-ink/80 p-3"
      role="dialog"
      aria-label={`${card.title} — ${ch.label}`}
      onClick={onClose}
    >
      <div
        className="px-panel px-scroll anim-pop max-h-full w-full max-w-[480px] overflow-y-auto p-3"
        onClick={(e) => e.stopPropagation()}
      >
        {body}
      </div>
    </div>
  );
}
