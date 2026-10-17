// 화면이 터졌을 때의 안전망: 하얀 화면 대신 [다시 시도] · [세이브 복사]. 터진 사실은 익명 이벤트로만 센다 (analytics.ts trackError)
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { exportSave } from '../game/hof';
import { trackError } from '../analytics';
import { pickCore, useStore } from '../store';

/** 지금 세이브를 내보내기 문자열로. 상태가 깨졌으면 저장소의 원문 그대로 */
function saveText(): string {
  try {
    return exportSave(pickCore(useStore.getState()));
  } catch {
    try {
      return localStorage.getItem('kbl-save-v1') ?? '';
    } catch {
      return '';
    }
  }
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean; copied: boolean }> {
  state = { failed: false, copied: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    trackError('render', error);
  }

  private copy = async () => {
    try {
      await navigator.clipboard.writeText(saveText());
      this.setState({ copied: true });
    } catch {
      /* 클립보드가 막힌 브라우저: 버튼 문구가 그대로 남는다 */
    }
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-3 bg-[#1b1a19] p-6 text-center font-pixel text-[14px] text-white" data-testid="crash">
        <div className="text-[18px] text-hi">문제가 생겼습니다</div>
        <div className="text-white/70">세이브는 그대로 있습니다. 다시 시도해 주세요.</div>
        <button className="px-btn primary min-h-11 w-56" onClick={() => location.reload()}>
          다시 시도
        </button>
        <button className="px-btn min-h-11 w-56" onClick={this.copy} data-testid="crash-copy">
          {this.state.copied ? '복사했습니다' : '세이브 복사 (만일을 위해)'}
        </button>
      </div>
    );
  }
}
