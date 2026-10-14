// 유저용 업데이트 소식. 배포할 때마다 맨 위에 한 항목을 더한다 (package.json 의 version 과 같은 번호).
// 문장은 게임 말투로 짧게, 3~5줄. 세이브가 이어지지 않는 변경이면 save: false 와 그 이유.
export interface ReleaseNote {
  version: string;
  date: string; // YYYY-MM-DD
  title: string;
  notes: string[];
  save?: false; // 세이브가 이어지지 않을 때만 false
}

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '0.10.0',
    date: '2026-10-14',
    title: '10구단 리그와 가을야구',
    notes: [
      '새로 시작하면 10구단·81경기 리그입니다. 가을야구는 5팀, 와일드카드 결정전부터 시작해요.',
      '한국시리즈를 우승하면 선수들이 마운드로 뛰어나옵니다. 다음 시즌 펜스에는 우승 현수막이 걸려요.',
      '정규시즌이 끝나면 최종 순위와 가을야구 대진표를 먼저 보여 줍니다. 가을야구는 천천히 보기·빨리 보기를 고를 수 있어요.',
      '시즌마다 단장 랭크(SS~F)가 매겨지고, 공유 카드가 야구 기록 위주로 바뀌었습니다.',
      '덮은 일은 이제 시즌 내내 따라다닙니다. 기자가 냄새를 맡을 수 있어요.',
    ],
  },
];

/** 이 버전 뒤로 나온 소식들 (처음 보는 유저면 최신 하나만) */
export function notesSince(seen: string | null): ReleaseNote[] {
  if (!seen) return RELEASE_NOTES.slice(0, 1);
  const i = RELEASE_NOTES.findIndex((n) => n.version === seen);
  return i < 0 ? RELEASE_NOTES.slice(0, 1) : RELEASE_NOTES.slice(0, i);
}
