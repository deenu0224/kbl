import { useState } from 'react';
import { getVolume, isMuted, play, setMuted, setVolume } from '../audio/sfx';

/** 음소거 토글 + 음량. inline 이면 펼친 채로(모바일 상단바 안), 아니면 🔊 버튼을 누르면 펼쳐진다. */
export default function SoundButton({ inline = false }: { inline?: boolean }) {
  const [open, setOpen] = useState(false);
  const [muted, setM] = useState(isMuted());
  const [vol, setV] = useState(getVolume());

  const toggle = () => {
    setMuted(!muted);
    setM(!muted);
    if (muted) play('click');
  };
  const slider = (
    <input
      type="range"
      min={0}
      max={1}
      step={0.05}
      value={vol}
      aria-label="음량"
      onChange={(e) => {
        const v = Number(e.target.value);
        setVolume(v);
        setV(v);
      }}
      onPointerUp={() => play('click')}
      className="w-24 accent-[#ffd84a] mob:h-8 mob:w-full mob:flex-1"
    />
  );

  if (inline) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <button className="px-btn shrink-0" data-sfx="none" onClick={toggle} aria-pressed={muted}>
          {muted ? '🔇 꺼짐' : '🔊 켜짐'}
        </button>
        {slider}
      </div>
    );
  }
  return (
    <div className="relative flex items-center">
      <button className="cursor-pointer px-1.5 text-[14px] leading-none" onClick={() => setOpen((v) => !v)} aria-label="소리 설정" aria-expanded={open}>
        {muted ? '🔇' : '🔊'}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="px-panel absolute top-full right-0 z-50 mt-1 flex items-center gap-2 p-2 whitespace-nowrap">
            <button className="px-btn" data-sfx="none" onClick={toggle} aria-pressed={muted}>
              {muted ? '🔇 꺼짐' : '🔊 켜짐'}
            </button>
            {slider}
          </div>
        </>
      )}
    </div>
  );
}
