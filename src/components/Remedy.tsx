import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { remedies, remedyNow, type Remedy } from "../game/remedy";
import type { Todo } from "../game/todo";
import { useCore, useStore } from "../store";
import Help from "./Help";
import type { HelpTopic } from "./helpTopics";
import Sheet from "./layout/Sheet";
import { useIsMobile } from "./layout/useLayout";
import { useUi } from "./layout/uiStore";
import { useGoScreen } from "./Todo";

const DONE_MS = 1000; // "✓ 결과"를 보여 주는 시간
const HELP_OF: Record<string, HelpTopic> = {
  hurt: "strength",
  fix: "strength",
  pen: "fatigue",
  over: "farm",
  fewB: "farm",
  fewP: "farm",
  cash: "runway",
  away: "demand",
};
const EDGE = { good: "#5fd38a", warn: "#ffd84a", bad: "#ff6b6b" } as const;

/** 데스크톱: 화면 가운데 작은 모달. 바깥을 누르거나 Esc 로 닫는다 */
function Modal({
  onClose,
  label,
  children,
}: {
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center"
      role="dialog"
      aria-label={label}
    >
      <div className="anim-fade absolute inset-0 bg-ink/65" onClick={onClose} />
      <div className="px-panel anim-fade relative max-h-[80vh] w-[420px] overflow-y-auto py-2">
        {children}
      </div>
    </div>
  );
}

/**
 * 조치 시트: 할 일을 탭하면 뜬다. 지금 실제로 가능한 조치가 결과 숫자와 함께 나오고, 한 번 탭으로 실행된다.
 * 모바일은 바텀 시트, 데스크톱은 작은 모달.
 */
export default function RemedySheet({
  todo,
  onClose,
}: {
  todo: Todo;
  onClose: () => void;
}) {
  const mobile = useIsMobile();
  const core = useCore();
  const go = useGoScreen();
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 실행한 뒤에는 목록을 다시 계산하지 않는다 (결과 줄만 보여 주고 닫힌다)
  const frozen = useRef<{ list: Remedy[]; now: string } | null>(null);
  const live = useMemo(
    () => ({ list: remedies(core, todo.id), now: remedyNow(core, todo.id) }),
    [core, todo.id],
  );
  if (!done) frozen.current = live;
  const { list, now } = frozen.current ?? live;

  useEffect(() => {
    if (!done) return;
    const id = setTimeout(onClose, DONE_MS);
    return () => clearTimeout(id);
  }, [done, onClose]);

  const run = (r: Remedy) => {
    if (done) return;
    const a = r.run;
    if (a.t === "none") return onClose();
    if (a.t === "dismiss") {
      useUi.getState().dismissTodo(todo.id);
      return onClose();
    }
    if (a.t === "go") {
      onClose();
      return go(a.to, a.sub);
    }
    const err = useStore.getState().remedy(r);
    if (err) return setError(err);
    setError(null);
    // 확인 항목은 조치하면 같이 닫는다 (지난 경기의 기록이라 상태로는 사라지지 않는다)
    if (todo.dismissible) useUi.getState().dismissTodo(todo.id);
    setDone(`${r.label} — ${r.effect}`);
  };

  const help = HELP_OF[todo.id.split("-")[0]];
  const body = (
    <div
      className="px-2 pb-3 pt-1 mob:px-3"
      data-testid="remedy-sheet"
      data-todo={todo.id}
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="min-w-0 flex-1 font-pixel-lg text-[15px] leading-snug text-hi mob:text-[16px]">
          {todo.text}
        </span>
        {help && <Help topic={help} />}
      </div>
      {now && (
        <div
          className="mb-2 text-[13px] leading-snug text-white/75"
          data-testid="remedy-now"
        >
          지금: {now}
        </div>
      )}
      {done ? (
        <div
          className="anim-fade flex min-h-12 items-center bg-good/20 px-3 py-2 text-[14px] leading-snug text-good"
          data-testid="remedy-done"
        >
          ✓ {done}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {list.length === 0 && (
            <div className="py-2 text-[13px] text-white/70">
              이미 해소됐습니다.
            </div>
          )}
          {list.map((r) => {
            const quiet = r.run.t === "none" || r.run.t === "dismiss";
            return (
              <button
                key={r.id}
                type="button"
                data-sfx="tab"
                data-remedy={r.id}
                className={`flex min-h-12 w-full cursor-pointer flex-col justify-center px-3 py-2 text-left ${quiet ? "bg-ink/40" : "bg-[#3d4c75]"}`}
                style={{
                  boxShadow: `inset 3px 0 0 ${quiet ? "rgba(255,255,255,.25)" : EDGE[r.tone ?? "good"]}`,
                }}
                onClick={() => run(r)}
              >
                <span
                  className={`text-[14px] leading-snug ${quiet ? "text-white/80" : "text-white"}`}
                >
                  {r.label}
                  {r.run.t === "go" && (
                    <span className="text-white/55"> ›</span>
                  )}
                </span>
                <span
                  className={`text-[13px] leading-snug ${r.tone === "bad" ? "text-bad" : r.tone === "warn" ? "text-hi/90" : "text-white/65"}`}
                >
                  {r.effect}
                </span>
              </button>
            );
          })}
          {list.length === 0 && (
            <button
              type="button"
              className="min-h-12 w-full cursor-pointer bg-ink/40 px-3 text-left text-[14px] text-white/80"
              onClick={onClose}
            >
              닫기
            </button>
          )}
        </div>
      )}
      {error && (
        <div
          className="mt-2 text-[13px] leading-snug text-bad"
          data-testid="remedy-error"
        >
          {error}
        </div>
      )}
      {!done && todo.action && !list.some((r) => r.run.t === "go") && (
        <button
          type="button"
          className="mt-2 min-h-8 w-full cursor-pointer text-right text-[13px] text-white/55"
          data-testid="remedy-go"
          onClick={() => {
            onClose();
            go(todo.action!, todo.hint === "pitchers" ? "pitchers" : "lineup");
          }}
        >
          화면에서 직접 고치기 ›
        </button>
      )}
    </div>
  );
  return createPortal(
    mobile ? (
      <Sheet onClose={onClose} label={todo.text}>
        {body}
      </Sheet>
    ) : (
      <Modal onClose={onClose} label={todo.text}>
        {body}
      </Modal>
    ),
    document.body,
  );
}
