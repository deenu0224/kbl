import { useMemo, useState } from "react";
import type { HintTab } from "../game/types";
import type { RemedyGo } from "../game/remedy";
import { todoList, type Todo, type TodoTab } from "../game/todo";
import RemedySheet from "./Remedy";
import { useCore, useStore } from "../store";
import { useIsMobile } from "./layout/useLayout";
import { useUi } from "./layout/uiStore";
import { openDesk } from "./roster/transferUi";

const TONE = {
  bad: "text-bad",
  warn: "text-hi",
  info: "text-white/85",
} as const;
const EDGE = { bad: "#ff6b6b", warn: "#ffd84a", info: "#7fd3ff" } as const;

/** 지금 해당하는 "할 일" (닫은 확인 항목은 뺀다). 탭 배지·홈 카드·탭 맨 위 줄이 같은 목록을 본다 */
export function useTodos(): Todo[] {
  const core = useCore();
  const dismissed = useUi((s) => s.dismissed);
  return useMemo(
    () => todoList(core).filter((t) => !dismissed.includes(t.id)),
    [core, dismissed],
  );
}

/** 이동한 화면에서 그 선수의 줄로 스크롤하고 잠깐 강조한다 (화면이 열릴 때까지 잠시 기다린다) */
export function spotlight(pid: string): void {
  let tries = 0;
  const tick = () => {
    const els = [...document.querySelectorAll<HTMLElement>(`[data-pid="${pid}"]`)].filter((el) => el.offsetParent !== null);
    const el = els[els.length - 1];
    if (!el) return void (++tries < 20 && setTimeout(tick, 100));
    el.scrollIntoView({ block: "center" });
    el.classList.add("spot");
    setTimeout(() => el.classList.remove("spot"), 2600);
  };
  setTimeout(tick, 200);
}

/** 조치 시트의 "화면 열기": 그 대상이 열린 화면으로 */
export function useGoScreen(): (
  to: RemedyGo,
  sub?: "lineup" | "pitchers",
  pid?: string,
) => void {
  const mobile = useIsMobile();
  return (to, sub, pid) => {
    if (pid) spotlight(pid);
    const ui = useUi.getState();
    const st = useStore.getState();
    const left = (sub: "lineup" | "pitchers") => {
      if (mobile) useUi.setState({ tab: "roster", rosterSub: sub });
      else st.setTab("left", sub);
    };
    const right = (sub: "league" | "finance" | "stadium") => {
      if (!mobile) st.setTab("right", sub);
      else if (sub === "league") ui.setTab("league");
      else useUi.setState({ tab: "club", clubSub: sub });
    };
    switch (to) {
      case "order":
        left(sub ?? "lineup");
        ui.setDailyOpen(true);
        break;
      case "pitchers":
        left("pitchers");
        break;
      case "squad":
        openDesk({ side: "squad" });
        break;
      case "market":
        openDesk({ side: "market", pos: "weak" });
        break;
      case "finance":
        right("finance");
        break;
      case "seats":
        right("stadium");
        if (mobile) ui.setFacSheet("seats");
        break;
      case "league":
        right("league");
        break;
      default:
        left("lineup");
    }
  };
}

/** 할 일 한 줄. 탭하면 조치 시트가 열린다 */
function Line({
  t,
  onGo,
  here = false,
}: {
  t: Todo;
  onGo: (t: Todo) => void;
  here?: boolean;
}) {
  const dismiss = useUi((s) => s.dismissTodo);
  return (
    <div
      className="flex min-h-7 items-stretch bg-ink/50 text-[11px] mob:min-h-10 mob:text-[13px]"
      style={{ boxShadow: `inset 3px 0 0 ${EDGE[t.tone]}` }}
      data-todo={t.id}
    >
      <button
        type="button"
        data-sfx="tab"
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 px-2 py-1 text-left"
        onClick={() => onGo(t)}
      >
        <span className={`w-4 shrink-0 text-center ${TONE[t.tone]}`}>
          {t.icon}
        </span>
        <span className={`min-w-0 flex-1 leading-snug ${TONE[t.tone]}`}>
          {t.text}
        </span>
        {!(here && t.dismissible) && (
          <span className="shrink-0 text-white/45">›</span>
        )}
      </button>
      {here && t.dismissible && (
        <button
          type="button"
          aria-label="확인하고 닫기"
          data-testid="todo-x"
          className="w-9 shrink-0 cursor-pointer text-white/55"
          onClick={() => dismiss(t.id)}
        >
          ×
        </button>
      )}
    </div>
  );
}

/** 홈의 "할 일" 카드: 최대 3줄 (+n). 항목이 없으면 카드도 없다 */
export function TodoCard({
  max = 3,
  className = "",
}: {
  max?: number;
  className?: string;
}) {
  const todos = useTodos();
  const [open, setOpen] = useState<Todo | null>(null);
  const sheet = open && (
    <RemedySheet todo={open} onClose={() => setOpen(null)} />
  );
  const rest = todos.length - max;
  // 조치로 항목이 전부 사라져도 시트는 같은 자리에 남아 결과("✓")를 보여 주고 스스로 닫힌다
  return (
    <>
      {todos.length > 0 && (
        <div
          className={`px-panel flex shrink-0 flex-col gap-[3px] p-1.5 ${className}`}
          data-testid="todo-card"
        >
          <div className="flex items-center justify-between px-0.5 text-[11px] text-white/55 mob:text-[13px]">
            <span>할 일 {todos.length}</span>
            {rest > 0 && <span data-testid="todo-more">+{rest}</span>}
          </div>
          {todos.slice(0, max).map((t) => (
            <Line key={t.id} t={t} onGo={setOpen} />
          ))}
        </div>
      )}
      {sheet}
    </>
  );
}

/** 탭 화면 맨 위: 그 탭에 속한 할 일을 한 줄씩. 확인 항목은 [×]로 닫는다 */
export function TodoLines({
  tab,
  hint,
  className = "",
}: {
  tab?: TodoTab;
  hint?: HintTab;
  className?: string;
}) {
  const todos = useTodos().filter(
    (t) => (tab ? t.tab === tab : true) && (hint ? t.hint === hint : true),
  );
  const [open, setOpen] = useState<Todo | null>(null);
  const sheet = open && (
    <RemedySheet todo={open} onClose={() => setOpen(null)} />
  );
  return (
    <>
      {todos.length > 0 && (
        <div
          className={`flex shrink-0 flex-col gap-[3px] ${className}`}
          data-testid="todo-lines"
        >
          {todos.map((t) => (
            <Line key={t.id} t={t} onGo={setOpen} here />
          ))}
        </div>
      )}
      {sheet}
    </>
  );
}
