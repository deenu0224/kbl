import { useState, type ReactNode } from 'react';
import { getVolume, isMuted, setMuted, setVolume, play } from '../audio/sfx';
import { getBgmVolume, isBgmMuted, setBgmMuted, setBgmVolume } from '../audio/bgm';
import { exportSave, importSave } from '../game/hof';
import { pickCore, useStore } from '../store';
import Dialog from './layout/Dialog';
import Help from './Help';
import { SAVE_KEY, useUi } from './layout/uiStore';
import { clearHof } from './hofStore';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center gap-2 bg-panel-2 px-2 py-1.5" style={{ boxShadow: '0 0 0 1px #0f1420' }}>
      <span className="w-[88px] shrink-0 text-[13px]">{label}</span>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">{children}</div>
    </div>
  );
}
const Title = ({ children }: { children: ReactNode }) => <div className="mt-3 mb-1 text-[13px] text-sky">{children}</div>;

function Volume({ label, get, set, muted, mute, test }: { label: string; get: () => number; set: (v: number) => void; muted: () => boolean; mute: (m: boolean) => void; test?: () => void }) {
  const [, tick] = useState(0);
  const re = () => tick((n) => n + 1);
  return (
    <Row label={label}>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={get()}
        aria-label={`${label} 음량`}
        className="h-8 min-w-0 flex-1 accent-[#ffd84a]"
        onChange={(e) => {
          set(Number(e.target.value));
          re();
        }}
        onPointerUp={test}
      />
      <span className="w-9 shrink-0 text-right text-[13px] text-white/70">{Math.round(get() * 100)}</span>
      <button
        className={`px-btn min-h-10 shrink-0 text-[13px] ${muted() ? '' : 'green'}`}
        data-sfx="none"
        onClick={() => {
          mute(!muted());
          re();
        }}
      >
        {muted() ? '꺼짐' : '켜짐'}
      </button>
    </Row>
  );
}

/** 설정: 소리 · 하이라이트 속도 · 2군 자동 운영 · 세이브 내보내기/가져오기 · 저장 데이터 지우기 */
export default function Settings() {
  const open = useUi((s) => s.settingsOpen);
  const setOpen = useUi((s) => s.setSettingsOpen);
  const fast = useUi((s) => s.fast);
  const setFast = useUi((s) => s.setFast);
  const hasSave = useUi((s) => s.hasSave);
  const farmAuto = useStore((s) => s.campaign.farmAuto !== false);
  const setFarmAuto = useStore((s) => s.setFarmAuto);
  const subAuto = useStore((s) => s.campaign.subAuto === true);
  const setSubAuto = useStore((s) => s.setSubAuto);
  const playback = useStore((s) => !!s.playback);
  const [out, setOut] = useState('');
  const [inp, setInp] = useState('');
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [armImport, setArmImport] = useState(false);
  const [armWipe, setArmWipe] = useState(false);
  const [wipeHof, setWipeHof] = useState(false);
  if (!open) return null;

  const close = () => {
    setOpen(false);
    setOut('');
    setInp('');
    setMsg(null);
    setArmImport(false);
    setArmWipe(false);
  };
  const doExport = () => {
    setOut(exportSave(pickCore(useStore.getState())));
    setMsg(null);
  };
  const doImport = () => {
    const r = importSave(inp);
    if ('error' in r) return setMsg({ text: r.error, ok: false });
    if (hasSave && !armImport) {
      setArmImport(true);
      return setMsg({ text: '지금 구단을 덮어씁니다. 한 번 더 누르면 가져옵니다', ok: true });
    }
    useStore.getState().loadSave(r.core, r.version);
    useUi.setState({ hasSave: true });
    setArmImport(false);
    setInp('');
    setMsg({ text: '가져왔습니다 — 이어하기로 시작하세요', ok: true });
  };
  const doWipe = () => {
    if (!armWipe) return setArmWipe(true);
    setArmWipe(false);
    useStore.getState().newGame();
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* 무시 */
    }
    if (wipeHof) clearHof();
    useUi.setState({ hasSave: false, screen: 'title' });
    setOut('');
    setMsg({ text: wipeHof ? '세이브와 명예의 전당을 지웠습니다' : '세이브를 지웠습니다 (명예의 전당은 남습니다)', ok: true });
  };

  return (
    // 초기 화면(z-65) 위에도 뜬다
    <div className="relative z-[80]">
    <Dialog onClose={close} label="설정" width={480}>
      <div className="m-shell text-[13px]" data-testid="settings">
        <div className="font-pixel-lg text-[16px] text-hi">설정</div>
        <Title>소리</Title>
        <div className="flex flex-col gap-1">
          <Volume label="효과음" get={getVolume} set={setVolume} muted={isMuted} mute={setMuted} test={() => play('coin')} />
          <Volume label="배경음악" get={getBgmVolume} set={setBgmVolume} muted={isBgmMuted} mute={setBgmMuted} />
        </div>
        <Title>진행</Title>
        <div className="flex flex-col gap-1">
          <Row label="하이라이트">
            {[false, true].map((f) => (
              <button key={String(f)} className={`px-btn min-h-10 text-[13px] ${fast === f ? 'gold' : ''}`} data-testid={f ? 'fast-on' : 'fast-off'} onClick={() => setFast(f)}>
                {f ? '빠르게' : '보통'}
              </button>
            ))}
          </Row>
          <Row label="2군 자동 운영">
            <span className="min-w-0 flex-1 text-[13px] text-white/55">부상·부진 때 알아서 올리고 내립니다</span>
            <button className={`px-btn min-h-10 shrink-0 text-[13px] ${farmAuto ? 'green' : ''}`} data-testid="farm-auto" disabled={playback} onClick={() => setFarmAuto(!farmAuto)}>
              {farmAuto ? '켜짐' : '꺼짐'}
            </button>
          </Row>
          <Row label="부상 대체">
            <span className="flex min-w-0 flex-1 items-center">
              <Help topic="farm" />
            </span>
            {[false, true].map((v) => (
              <button key={String(v)} className={`px-btn min-h-10 shrink-0 text-[13px] ${subAuto === v ? 'gold' : ''}`} data-testid={v ? 'sub-auto' : 'sub-manual'} disabled={playback} onClick={() => setSubAuto(v)}>
                {v ? '감독에게 맡기기' : '직접 고르기'}
              </button>
            ))}
          </Row>
        </div>
        <Title>세이브</Title>
        <div className="flex flex-col gap-1.5 bg-panel-2 p-2" style={{ boxShadow: '0 0 0 1px #0f1420' }}>
          <div className="flex flex-wrap gap-2">
            <button className="px-btn min-h-10 text-[13px]" data-testid="export" disabled={!hasSave || playback} onClick={doExport}>
              내보내기
            </button>
            {out && (
              <>
                <button
                  className="px-btn min-h-10 text-[13px]"
                  onClick={() => navigator.clipboard?.writeText(out).then(() => setMsg({ text: '복사했습니다', ok: true }), () => setMsg({ text: '복사하지 못했습니다 — 글자를 직접 선택하세요', ok: false }))}
                >
                  복사
                </button>
                <a className="px-btn flex min-h-10 items-center text-[13px]" href={`data:text/plain;charset=utf-8,${out}`} download="kbl-save.txt">
                  파일로 저장
                </a>
              </>
            )}
          </div>
          {out && <textarea readOnly value={out} data-testid="export-text" className="h-20 w-full select-text bg-ink p-1 !text-[13px] text-white/70" onFocus={(e) => e.currentTarget.select()} />}
          <textarea
            value={inp}
            placeholder="내보낸 글자를 여기에 붙여 넣으세요"
            data-testid="import-text"
            className="h-20 w-full select-text bg-ink p-1 !text-[13px] text-white"
            onChange={(e) => {
              setInp(e.target.value);
              setArmImport(false);
            }}
          />
          <div className="flex items-center gap-2">
            <button className={`px-btn min-h-10 text-[13px] ${armImport ? 'primary' : ''}`} data-testid="import" disabled={!inp.trim() || playback} onClick={doImport}>
              {armImport ? '정말 덮어쓰기' : '가져오기'}
            </button>
            {msg && (
              <span className={`min-w-0 flex-1 text-[13px] ${msg.ok ? 'text-good' : 'text-bad'}`} data-testid="settings-msg">
                {msg.text}
              </span>
            )}
          </div>
        </div>
        <Title>저장 데이터 지우기</Title>
        <div className="flex flex-wrap items-center gap-2 bg-panel-2 p-2" style={{ boxShadow: '0 0 0 1px #0f1420' }}>
          <label className="flex min-h-10 flex-1 cursor-pointer items-center gap-2 text-[13px]">
            <input type="checkbox" className="h-5 w-5 accent-[#ffd84a]" checked={wipeHof} data-testid="wipe-hof" onChange={(e) => setWipeHof(e.target.checked)} />
            명예의 전당도 함께
          </label>
          <button className={`px-btn min-h-10 text-[13px] ${armWipe ? 'primary' : ''}`} data-testid="wipe" disabled={playback} onClick={doWipe}>
            {armWipe ? '정말 지우기 (되돌릴 수 없음)' : '지우기'}
          </button>
        </div>
      </div>
    </Dialog>
    </div>
  );
}
