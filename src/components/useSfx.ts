import { useEffect } from 'react';
import { play as playSfx, unlock, type SfxName } from '../audio/sfx';
import { duckBgm } from '../audio/bgm';
import { useStore } from '../store';
import { fastFor, useUi } from './layout/uiStore';
import { clinchesTitle } from '../game/postseason';

/**
 * 효과음 연결 (App 에서 한 번).
 * - 첫 포인터 입력에서 오디오 잠금 해제
 * - 버튼 클릭은 위임으로 처리: data-sfx="tab" 같은 속성이 있으면 그 소리, "none" 이면 무음
 * - 게임 사건(영입·증축·하이라이트·승패·이벤트 카드·결산)은 스토어 변화를 보고 재생
 */
// 긴 효과음이 나는 동안은 배경음악을 낮춘다 (초)
const LONG: Partial<Record<SfxName, number>> = { homerun: 1.6, walkoff: 2.4, win: 1.8, lose: 1.8, champion: 3.6, achievement: 1.6, crown: 6.8, crownShort: 3 };
function play(name: SfxName): void {
  playSfx(name);
  const d = LONG[name];
  if (d) duckBgm(d);
}

export function useSfx(): void {
  useEffect(() => {
    const onDown = () => unlock();
    const onClick = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      const tagged = el?.closest<HTMLElement>('[data-sfx]');
      const name = tagged?.dataset.sfx;
      if (name === 'none') return;
      if (name) return play(name as SfxName);
      const btn = el?.closest('button');
      if (btn && !btn.disabled) play('click');
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('click', onClick, true);

    const unsub = useStore.subscribe((s, p) => {
      // 알림: 오류
      if (s.toast && s.toast !== p.toast && s.toast.tone === 'bad') play('error');
      // 증축
      if (s.fx && s.fx !== p.fx) play('build');
      // 영입·지명 (계약금 지출 + 로스터 증가)
      if (s.finance.ledger.signing > p.finance.ledger.signing && s.season === p.season) {
        const n = (st: typeof s) => st.teams.find((t) => t.id === st.userId)?.roster.length ?? 0;
        if (n(s) > n(p)) play('buy');
      }
      // 하이라이트
      const pb = s.playback;
      if (pb && (pb !== p.playback) && (pb.step !== p.playback?.step || pb.report !== p.playback?.report)) {
        const ev = pb.report.result.events[pb.step];
        const mine = ev?.teamId === s.userId;
        if (ev?.moment && ev.type === 'start') play(mine ? 'hit' : 'click'); // 천천히 보기의 위기 장면
        else if (ev?.type === 'start') play('playball');
        else if (ev?.type === 'hr') play(mine ? 'homerun' : 'groan');
        else if (ev?.type === 'score') play(mine ? 'hit' : 'groan');
        else if (ev?.type === 'walkoff') play(mine ? 'walkoff' : 'groan');
        else if (ev?.type === 'injury') play('injury');
        else if (ev?.type === 'final' && clinchesTitle(pb.report)) play(fastFor(useUi.getState(), s, true) ? 'crownShort' : 'crown');
        else if (ev?.type === 'final') play(pb.report.won === false ? 'lose' : pb.report.won ? 'win' : 'click');
      }
      // 하이라이트 없이 끝난 경기 / 일괄 진행
      if (s.summary && s.summary !== p.summary && !p.playback) {
        const last = s.summary[s.summary.length - 1];
        if (s.summary.length > 1) play('coin');
        else play(last.won === false ? 'lose' : last.won ? 'win' : 'click');
        if (s.summary.some((r) => r.result.injuries.some((x) => x.teamId === s.userId))) play('injury');
      }
      // 이벤트 카드 등장 (요약을 닫은 뒤 화면에 뜰 때)
      const shown = (st: typeof s) => (st.campaign.event && !st.summary && !st.playback ? st.campaign.event.id : null);
      if (shown(s) && shown(s) !== shown(p)) play('event');
      // 결산: 요약을 닫아 결산 화면이 뜨는 순간
      const verdictUp = (st: typeof s) => (st.campaign.verdict && (st.phase === 'ended' || st.phase === 'over') && !st.summary && !st.playback ? st.campaign.verdict : null);
      const v = verdictUp(s);
      if (v && v !== verdictUp(p)) {
        if (s.post?.championId === s.userId) play('champion');
        else if (v.fired) play('lose');
        else if (v.cleared || s.campaign.objectives.some((o) => !o.main && o.state === 'done')) play('achievement');
        else play('groan');
      }
    });

    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('click', onClick, true);
      unsub();
    };
  }, []);
}
