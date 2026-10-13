import { useState, type ReactNode } from 'react';

/** [자세히 ▾]: 기본 화면에서 뺀 숫자를 접어 둔다. 탭하면 펼친다 */
export default function Fold({ label = '자세히', children, className = '', testid }: { label?: ReactNode; children: ReactNode; className?: string; testid?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className} data-testid={testid} data-open={open ? '1' : '0'}>
      <button
        type="button"
        data-sfx="tab"
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-1 bg-ink/40 px-1.5 py-1 text-left text-[11px] text-white/65 mob:min-h-9 mob:text-[13px]"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="shrink-0 text-white/45">{open ? '▴' : '▾'}</span>
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
}
