import { memo, useEffect, useRef } from 'react';

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function seeded(seed: number) {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SKIN = ['#f6d3b0', '#eec39a', '#e0ac7e', '#c98d5e', '#a86f45', '#7d4f30'];
const SKIN_KR = ['#f6d3b0', '#eec39a', '#e8b98c'];
const HAIR = ['#1a1a1a', '#2b1d14', '#3a2a1c', '#4a3020'];
const HAIR_F = ['#1a1a1a', '#4a3020', '#8a5a2b', '#c9a14a', '#b5532a'];

function shade(hex: string, k: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * k)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** 선수 id 를 시드로 16×16 픽셀 초상을 절차적으로 그린다. */
function PixelFace({
  id,
  color,
  color2 = '#ffffff',
  foreign = false,
  size = 48,
  className = '',
}: {
  id: string;
  color: string;
  color2?: string;
  foreign?: boolean;
  size?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const r = seeded(hash(id));
    const px = (x: number, y: number, w: number, h: number, c: string) => {
      ctx.fillStyle = c;
      ctx.fillRect(x, y, w, h);
    };
    const skin = foreign ? SKIN[Math.floor(r() * SKIN.length)] : SKIN_KR[Math.floor(r() * SKIN_KR.length)];
    const hair = foreign ? HAIR_F[Math.floor(r() * HAIR_F.length)] : HAIR[Math.floor(r() * HAIR.length)];
    const eyeStyle = Math.floor(r() * 4);
    const mouth = Math.floor(r() * 4);
    const brow = Math.floor(r() * 3);
    const wide = r() < 0.4;
    const beard = r() < (foreign ? 0.45 : 0.12);
    const glasses = r() < 0.08;
    const sideHair = r() < 0.6;
    const eyeBlack = r() < 0.25; // 아이블랙

    ctx.clearRect(0, 0, 16, 16);
    // 배경
    px(0, 0, 16, 16, shade(color, 0.42));
    px(0, 12, 16, 4, shade(color, 0.3));

    // 유니폼 어깨
    px(2, 13, 12, 3, '#f4f4f4');
    px(2, 13, 1, 3, color);
    px(13, 13, 1, 3, color);
    px(7, 13, 2, 3, color2 === '#ffffff' ? color : color2);
    // 목
    px(6, 11, 4, 2, shade(skin, 0.86));

    // 얼굴
    const fx = wide ? 3 : 4;
    const fw = wide ? 10 : 8;
    px(fx, 5, fw, 6, skin);
    px(fx + 1, 11, fw - 2, 1, skin);
    // 귀
    px(fx - 1, 7, 1, 2, shade(skin, 0.9));
    px(fx + fw, 7, 1, 2, shade(skin, 0.9));
    // 옆머리
    if (sideHair) {
      px(fx, 5, 1, 2, hair);
      px(fx + fw - 1, 5, 1, 2, hair);
    }

    // 모자
    px(fx, 2, fw, 3, color);
    px(fx + 1, 1, fw - 2, 1, color);
    px(fx, 2, fw, 1, shade(color, 1.2));
    px(fx - 1, 5, fw + 2, 1, shade(color, 0.7)); // 챙
    px(7, 2, 2, 2, color2); // 로고

    // 눈썹
    const ey = 7;
    const lx = fx + (wide ? 2 : 1);
    const rx = fx + fw - (wide ? 4 : 3);
    if (brow > 0) {
      px(lx, ey - 1, 2, 1, brow === 2 ? hair : shade(skin, 0.7));
      px(rx, ey - 1, 2, 1, brow === 2 ? hair : shade(skin, 0.7));
    }
    // 눈
    if (eyeStyle === 0) {
      px(lx, ey, 2, 1, '#fff');
      px(rx, ey, 2, 1, '#fff');
      px(lx + 1, ey, 1, 1, '#1a1a1a');
      px(rx, ey, 1, 1, '#1a1a1a');
    } else if (eyeStyle === 1) {
      px(lx, ey, 2, 1, '#1a1a1a');
      px(rx, ey, 2, 1, '#1a1a1a');
    } else if (eyeStyle === 2) {
      px(lx + 1, ey, 1, 1, '#1a1a1a');
      px(rx, ey, 1, 1, '#1a1a1a');
    } else {
      px(lx, ey, 2, 2, '#fff');
      px(rx, ey, 2, 2, '#fff');
      px(lx + 1, ey + 1, 1, 1, '#1a1a1a');
      px(rx, ey + 1, 1, 1, '#1a1a1a');
    }
    if (glasses) {
      px(lx - 1, ey - 0, 4, 1, 'rgba(20,20,30,.55)');
      px(rx - 1, ey - 0, 4, 1, 'rgba(20,20,30,.55)');
      px(lx + 2, ey, rx - lx - 2, 1, '#222');
    }
    if (eyeBlack) {
      px(lx, ey + 1 + (eyeStyle === 3 ? 1 : 0), 2, 1, '#2a2a2a');
      px(rx, ey + 1 + (eyeStyle === 3 ? 1 : 0), 2, 1, '#2a2a2a');
    }
    // 코
    px(7, 8, 1, 1, shade(skin, 0.82));
    // 수염
    if (beard) {
      px(fx, 9, fw, 2, shade(hair, 1.25));
      px(fx + 1, 11, fw - 2, 1, shade(hair, 1.25));
    }
    // 입
    const mc = beard ? '#f0d0c0' : '#8a3b32';
    if (mouth === 0) px(6, 10, 4, 1, mc);
    else if (mouth === 1) px(7, 10, 2, 1, mc);
    else if (mouth === 2) {
      px(6, 10, 4, 1, '#fff');
      px(6, 10, 1, 1, mc);
      px(9, 10, 1, 1, mc);
    } else {
      px(6, 10, 3, 1, mc);
      px(9, 9, 1, 1, mc);
    }
  }, [id, color, color2, foreign]);

  return (
    <canvas
      ref={ref}
      width={16}
      height={16}
      className={`pixel shrink-0 ${className}`}
      style={{ width: size, height: size, imageRendering: 'pixelated' }}
    />
  );
}

export default memo(PixelFace);
