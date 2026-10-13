import { useState } from 'react';
import Sheet from './layout/Sheet';
import { HELP, type HelpTopic } from './helpTopics';

/**
 * "?" 버튼. 화면에는 핵심 숫자만 두고, 규칙·세부 설명은 이 버튼 뒤로 숨긴다.
 * 사용: <Help topic="potential" />  — 내용은 helpTopics.ts 에서 관리한다.
 * children 을 주면 설명 아래에 그 화면의 실제 수치(표·막대)를 함께 보여준다.
 */
export default function Help({ topic, children, className }: { topic: HelpTopic; children?: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const t = HELP[topic];
  return (
    <>
      <button
        type="button"
        aria-label={`${t.title} 설명`}
        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[12px] leading-none text-white/70 ${className ?? ''}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        ?
      </button>
      {open && (
        <Sheet onClose={() => setOpen(false)} label={t.title}>
          <div className="px-4 pb-5 pt-1">
            <div className="font-pixel-lg mb-2 text-[16px] text-hi">{t.title}</div>
            {t.lines.map((l, i) => (
              <p key={i} className="mb-1.5 text-[13px] leading-relaxed text-white/85">
                {l}
              </p>
            ))}
            {children && <div className="mt-3">{children}</div>}
          </div>
        </Sheet>
      )}
    </>
  );
}
