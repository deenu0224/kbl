import { clinchesTitle } from '../game/postseason';
import { useStore } from '../store';

/** [건너뛰기]: 한국시리즈 우승이 확정되는 경기면 우승 세리머니(마지막 장면)로만 건너뛰고, 그 밖에는 하이라이트를 끝낸다 */
export function skipOrCeremony(): void {
  const s = useStore.getState();
  const pb = s.playback;
  const last = pb ? pb.report.result.events.length - 1 : -1;
  if (pb && pb.step < last && pb.report.result.events[last]?.type === 'final' && clinchesTitle(pb.report)) s.skipPlayback(true);
  else s.skipPlayback();
}
