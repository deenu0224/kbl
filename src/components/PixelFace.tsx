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

/**
 * 인물(CHARACTERS) 전용 고정 외모: id 가 `char-<seed>` 일 때만 쓴다. 44px 에서도 한눈에 구분되게
 * 모자 유무·머리색·안경·수염·옷 색을 인물마다 다르게 고정한다 (선수 초상 생성은 그대로).
 */
interface Look {
  hat: boolean;
  hair: string;
  long?: boolean; // 어깨까지 내려오는 머리
  glasses?: boolean;
  beard?: 'full' | 'stache';
  cloth: string; // 옷 색 (유니폼 대신)
  trim?: string; // 옷깃·넥타이
  skin: string;
  wide?: boolean;
  eye: number;
  mouth: number;
}
const LOOKS: Record<string, Look> = {
  'char-7101': { hat: true, hair: '#2b1d14', beard: 'stache', cloth: '#f4f4f4', skin: '#e0ac7e', wide: true, eye: 1, mouth: 0 }, // 감독: 구단 모자 · 콧수염 · 유니폼
  'char-7102': { hat: false, hair: '#c8c8c8', glasses: true, cloth: '#6b4a2f', trim: '#e8dcc0', skin: '#eec39a', eye: 2, mouth: 1 }, // 스카우트 팀장: 백발 · 안경 · 갈색 점퍼
  'char-7103': { hat: false, hair: '#8a4a2b', long: true, cloth: '#e86a8a', trim: '#ffffff', skin: '#f6d3b0', eye: 3, mouth: 2 }, // 마케팅 팀장: 긴 갈색 머리 · 분홍 블라우스
  'char-7104': { hat: true, hair: '#1a1a1a', beard: 'full', cloth: '#3f8f5a', skin: '#c98d5e', wide: true, eye: 1, mouth: 1 }, // 2군 코치: 모자 · 턱수염 · 그을린 얼굴 · 초록 훈련복
  'char-7105': { hat: true, hair: '#1a1a1a', glasses: true, cloth: '#2f4f8f', trim: '#cfd6ea', skin: '#eec39a', eye: 2, mouth: 0 }, // 투수 코치: 모자 · 안경 · 남색 바람막이
  'char-7106': { hat: false, hair: '#9a9aa6', cloth: '#7a4f9a', trim: '#ffb347', skin: '#e8b98c', wide: true, eye: 0, mouth: 3 }, // 조합장: 회색 파마 · 보라 조끼 · 귤색 깃
  'char-7107': { hat: false, hair: '#101014', glasses: true, cloth: '#22262f', trim: '#c0392b', skin: '#f6d3b0', eye: 1, mouth: 1 }, // 유치위원장: 검은 올백 · 안경 · 정장에 붉은 넥타이
};

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
    let skin = foreign ? SKIN[Math.floor(r() * SKIN.length)] : SKIN_KR[Math.floor(r() * SKIN_KR.length)];
    let hair = foreign ? HAIR_F[Math.floor(r() * HAIR_F.length)] : HAIR[Math.floor(r() * HAIR.length)];
    let eyeStyle = Math.floor(r() * 4);
    let mouth = Math.floor(r() * 4);
    let brow = Math.floor(r() * 3);
    let wide = r() < 0.4;
    let beard = r() < (foreign ? 0.45 : 0.12);
    let glasses = r() < 0.08;
    let sideHair = r() < 0.6;
    let eyeBlack = r() < 0.25; // 아이블랙
    const look = LOOKS[id];
    if (look) {
      skin = look.skin;
      hair = look.hair;
      eyeStyle = look.eye;
      mouth = look.mouth;
      brow = 2;
      wide = !!look.wide;
      beard = !!look.beard;
      glasses = !!look.glasses;
      sideHair = !look.hat;
      eyeBlack = false;
    }

    ctx.clearRect(0, 0, 16, 16);
    // 배경
    px(0, 0, 16, 16, shade(color, 0.42));
    px(0, 12, 16, 4, shade(color, 0.3));

    // 유니폼 어깨 (인물은 제 옷)
    if (look && !(look.hat && look.cloth === '#f4f4f4')) {
      px(2, 13, 12, 3, look.cloth);
      px(1, 14, 14, 2, look.cloth);
      if (look.trim) px(7, 13, 2, 3, look.trim);
    } else {
      px(2, 13, 12, 3, '#f4f4f4');
      px(2, 13, 1, 3, color);
      px(13, 13, 1, 3, color);
      px(7, 13, 2, 3, color2 === '#ffffff' ? color : color2);
    }
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

    if (look && !look.hat) {
      // 맨머리: 정수리부터 이마까지 머리칼, 긴 머리는 어깨까지
      px(fx, 2, fw, 3, hair);
      px(fx + 1, 1, fw - 2, 1, hair);
      px(fx - 1, 3, fw + 2, 3, hair);
      px(fx + 1, 4, fw - 2, 1, shade(hair, 1.25));
      px(fx + 2, 5, fw - 4, 1, skin); // 이마
      if (look.long) {
        px(fx - 1, 5, 2, 8, hair);
        px(fx + fw - 1, 5, 2, 8, hair);
      }
    } else {
      // 모자
      px(fx, 2, fw, 3, color);
      px(fx + 1, 1, fw - 2, 1, color);
      px(fx, 2, fw, 1, shade(color, 1.2));
      px(fx - 1, 5, fw + 2, 1, shade(color, 0.7)); // 챙
      px(7, 2, 2, 2, color2); // 로고
    }

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
    if (glasses && look) {
      // 인물의 안경은 44px 에서도 보이게 테를 진하게
      px(lx - 1, ey - 1, 4, 1, '#111');
      px(rx - 1, ey - 1, 4, 1, '#111');
      px(lx - 1, ey + 1, 4, 1, '#111');
      px(rx - 1, ey + 1, 4, 1, '#111');
      px(lx + 3, ey, Math.max(0, rx - lx - 4), 1, '#111');
    } else if (glasses) {
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
    if (look?.beard === 'stache') {
      px(6, 9, 4, 1, hair);
    } else if (beard) {
      px(fx, 9, fw, 2, shade(hair, 1.25));
      px(fx + 1, 11, fw - 2, 1, shade(hair, 1.25));
    }
    // 입
    const mc = beard && look?.beard !== 'stache' ? '#f0d0c0' : '#8a3b32';
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
