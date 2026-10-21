import { create } from 'zustand';
import type { PosKey } from '../../game/analysis';
import { BASKET_KINDS, emptyBasket, type Basket, type BasketKind } from '../../game/transfer';
import { useStore } from '../../store';

export type DeskSide = 'market' | 'squad';

interface TransferUi {
  open: boolean;
  inline: boolean; // 폰 이적 탭이 창구를 그 자리에 그리고 있다 (그동안 전체 화면 창구는 띄우지 않는다)
  seasonHost: boolean; // 결산 화면이 제 창구를 그린다 (결산 위에 떠야 해서). 그동안 앱의 창구는 그리지 않는다 — 두 겹이었다
  basket: Basket;
  side: DeskSide; // 모바일에서 보이는 목록
  pos: PosKey | 'weak' | null; // 영입 시장을 이 포지션으로 걸러서 연다
  nonce: number; // 열 때마다 바뀐다 (표의 필터를 새로 잡는다)
  sort: 'release' | null; // 우리 선수단을 이 정렬로 연다 (할 일 "방출 검토")
  /** 창구를 연다. add 를 주면 그 선수를 담은 채로, pos 를 주면 영입 시장을 그 자리로 걸러서 */
  openDesk(o?: { side?: DeskSide; pos?: PosKey | 'weak' | null; add?: [BasketKind, string][]; sort?: 'release' }): void;
  close(): void;
  toggle(kind: BasketKind, pid: string): void; // 담기 / 다시 누르면 빼기 (한 선수는 한 칸에만)
  put(kind: BasketKind, pid: string): void;
  clear(): void;
}

const without = (b: Basket, pid: string): Basket => ({
  sign: b.sign.filter((x) => x !== pid),
  release: b.release.filter((x) => x !== pid),
  down: b.down.filter((x) => x !== pid),
  up: b.up.filter((x) => x !== pid),
});

/** 그 사이에 팀을 떠났거나 시장에서 사라진 선수는 바구니에서 뺀다 */
function prune(b: Basket): Basket {
  const s = useStore.getState();
  const mine = new Set((s.teams.find((t) => t.id === s.userId)?.roster ?? []).map((p) => p.id));
  const fa = new Set(s.freeAgents.map((p) => p.id));
  const out = emptyBasket();
  for (const k of BASKET_KINDS) out[k] = b[k].filter((id) => (k === 'sign' ? fa : mine).has(id));
  return out;
}

export const useTransferUi = create<TransferUi>()((set) => ({
  open: false,
  inline: false,
  seasonHost: false,
  basket: emptyBasket(),
  side: 'market',
  pos: null,
  nonce: 0,
  sort: null,
  openDesk: (o = {}) =>
    set((s) => {
      let basket = prune(s.basket);
      for (const [k, pid] of o.add ?? []) basket = { ...without(basket, pid), [k]: [...without(basket, pid)[k], pid] };
      const first = o.add?.[0]?.[0];
      return { open: true, basket, side: o.side ?? (first ? (first === 'sign' ? 'market' : 'squad') : s.side), pos: o.pos ?? null, sort: o.sort ?? null, nonce: s.nonce + 1 };
    }),
  close: () => set({ open: false }),
  toggle: (kind, pid) =>
    set((s) => {
      const rest = without(s.basket, pid);
      return { basket: s.basket[kind].includes(pid) ? rest : { ...rest, [kind]: [...rest[kind], pid] } };
    }),
  put: (kind, pid) =>
    set((s) => {
      const rest = without(s.basket, pid);
      return { basket: { ...rest, [kind]: [...rest[kind], pid] } };
    }),
  clear: () => set({ basket: emptyBasket() }),
}));

export const openDesk = (o?: Parameters<TransferUi['openDesk']>[0]) => useTransferUi.getState().openDesk(o);
