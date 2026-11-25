import { SITE_NAME } from '../public/lib/site-config.js';

export const chrome = {
  ko: {
    home: '홈', guides: '여행 가이드', privacy: '개인정보처리방침', about: '소개', contact: '문의', terms: '이용약관',
    nav: '사이트 메뉴', index: '도시별 여행 동선과 준비 팁을 찾아보세요.',
    operator: `${SITE_NAME}은 여행 일정을 쉽게 짜고 함께 나눌 수 있도록 만든 여행 플래너입니다. 지도에서 일정을 짜고 가계부와 체크리스트를 관리할 수 있습니다. 여행은 브라우저에 저장됩니다.`,
    contactIntro: '오류 신고, 기능 제안, 개인정보 관련 문의를 받습니다. 예약번호나 여권 정보는 보내지 마세요.',
    contactHelp: '오류를 알려 주실 때는 쓰신 기기, 브라우저, 화면 캡처를 함께 보내 주시면 빨리 확인할 수 있어요.', copy: '주소 복사', copied: '복사했어요', openApp: '앱 열기', menu: '메뉴', lang: '언어',
    termsIntro: '여행 가이드와 도구는 일정 계획에 참고할 수 있습니다. 요금, 운영 시간, 입국 조건은 출발 전에 공식 출처에서 확인하세요. 공유 링크를 보내기 전에 포함된 정보를 확인하고, 여행을 보관하려면 백업 파일을 저장하세요.',
    privacyIntro: 'XenoTravel의 브라우저 저장, 외부 서비스, 공유 링크, 광고 쿠키에 관한 안내입니다.',
    draft: '초안', sources: '출처 (확인일)', plan: '이 도시로 일정 만들기', course: '이 코스로 일정 만들기',
    visit: (y, m) => `직접 다녀온 후기 · ${y}년 ${m}월 방문`,
  },
  en: {
    home: 'Home', guides: 'Travel guides', privacy: 'Privacy policy', about: 'About', contact: 'Contact', terms: 'Terms of use',
    nav: 'Site navigation', index: 'Find itineraries and practical tips by destination.',
    operator: `${SITE_NAME} is a trip planner made to help you plan trips easily and share them with others. Plan on a map and manage budgets and checklists. Trips are stored in your browser.`,
    contactIntro: 'We accept bug reports, feature suggestions, and privacy inquiries. Please do not send booking numbers or passport details.',
    contactHelp: 'When reporting a bug, include your device, browser, and a screenshot so we can check it quickly.', copy: 'Copy address', copied: 'Copied', openApp: 'Open app', menu: 'Menu', lang: 'Language',
    termsIntro: 'Use the guides and tools to help plan your trip. Check official sources for prices, hours, and entry requirements before traveling. Review the contents of share links before sending them and save a backup file to keep your trips.',
    privacyIntro: 'How XenoTravel handles browser storage, external services, share links, and advertising cookies.',
    draft: 'Draft', sources: 'Sources (date checked)', plan: 'Plan a trip to this city', course: 'Plan a trip with this course',
    visit: (y, m) => `Firsthand experience · Visited ${y}-${String(m).padStart(2, '0')}`,
  },
  zh: {
    home: '首页', guides: '旅行指南', privacy: '隐私政策', about: '关于', contact: '联系', terms: '使用条款',
    nav: '网站导航', index: '查找各城市的行程和实用旅行建议。',
    operator: `${SITE_NAME} 是一款让你轻松规划行程并与他人分享的旅行规划工具。你可以在地图上规划行程，管理预算和清单。行程保存在浏览器中。`,
    contactIntro: '我们受理问题报告、功能建议和个人信息相关咨询。请勿发送预订编号或护照信息。',
    contactHelp: '报告问题时，请附上所用设备、浏览器和屏幕截图，便于我们尽快确认。', copy: '复制地址', copied: '已复制', openApp: '打开应用', menu: '菜单', lang: '语言',
    termsIntro: '旅行指南和工具可供行程规划参考。出发前请通过官方来源确认价格、开放时间和入境条件。发送分享链接前请检查其中的信息，并保存备份文件以保留行程。',
    privacyIntro: '了解 XenoTravel 如何处理浏览器存储、外部服务、分享链接和广告 Cookie。',
    draft: '草稿', sources: '来源（核对日期）', plan: '规划这座城市的行程', course: '用这条路线创建行程',
    visit: (y, m) => `实地体验 · ${y}年${m}月到访`,
  },
  ja: {
    home: 'ホーム', guides: '旅行ガイド', privacy: 'プライバシーポリシー', about: 'サービス紹介', contact: 'お問い合わせ', terms: '利用規約',
    nav: 'サイト内メニュー', index: '都市別のモデルコースと旅行のヒントを探せます。',
    operator: `${SITE_NAME} は旅の日程を手軽に組み、みんなで共有できるように作った旅行プランナーです。地図で旅程を組み、予算やチェックリストを管理できます。旅行データはブラウザに保存されます。`,
    contactIntro: '不具合の報告、機能の提案、個人情報に関するお問い合わせを受け付けています。予約番号やパスポート情報は送らないでください。',
    contactHelp: '不具合のご報告の際は、お使いの端末・ブラウザ・画面のスクリーンショットを添えていただくと早く確認できます。', copy: 'アドレスをコピー', copied: 'コピーしました', openApp: 'アプリを開く', menu: 'メニュー', lang: '言語',
    termsIntro: '旅行ガイドとツールは計画の参考にできます。料金、営業時間、入国条件は出発前に公式情報をご確認ください。共有リンクは内容を確認してから送り、旅行データはバックアップファイルで保管してください。',
    privacyIntro: 'XenoTravel のブラウザ保存、外部サービス、共有リンク、広告 Cookie について説明します。',
    draft: '下書き', sources: '出典（確認日）', plan: 'この都市の旅程を作る', course: 'このコースで旅程を作る',
    visit: (y, m) => `実際に訪れた感想 · ${y}年${m}月訪問`,
  },
};

export const usage = [
  { slug: 'plan', title: 'XenoTravel에서 일정 짜기', description: '여행지와 날짜를 정하고 지도에서 장소를 날짜별로 배치하는 방법입니다.',
    body: '홈에서 여행지와 시작일·종료일을 입력해 여행을 만드세요. 검색하거나 지도에서 고른 장소는 날짜를 정하기 전까지 보관함에 넣어 둘 수 있습니다. 지도에서 가까운 장소를 묶어 같은 날로 옮기고, 예약이 있는 장소에는 시간을 입력하세요. 일정에서 이동 순서를 바꾸면 지도 동선도 함께 바뀝니다.' },
  { slug: 'budget', title: 'XenoTravel 가계부 쓰기', description: '현지 통화로 쓴 돈과 계획한 비용을 확인하는 방법입니다.',
    body: '여행의 가계부 탭에서 현지 통화를 확인한 뒤 예산을 입력하세요. 기록할 때 금액과 날짜, 지출 분류를 고를 수 있습니다. 환율이 아직 없는 기록은 환율 미정으로 표시됩니다. 장소나 체크리스트에 예상 금액을 입력하면 가계부에서 계획한 지출과 실제로 쓴 돈을 함께 볼 수 있습니다.' },
  { slug: 'sharing', title: 'XenoTravel 일정 공유하기', description: '동행에게 공유 링크를 보내고 상대가 자신의 여행으로 저장하는 방법입니다.',
    body: '여행 화면에서 공유를 선택하고 보내기 전에 내용을 확인하세요. 기본 공유 링크에는 일정과 지도 장소가 담기고, 메모와 예약번호는 기본 설정에서 제외됩니다. 동행은 링크를 열어 일정을 보거나 자신의 브라우저에 복사할 수 있습니다. 여행을 수정한 뒤 변경된 내용을 보내려면 새 링크를 만드세요.' },
  { slug: 'backup', title: 'XenoTravel 여행 백업하기', description: '브라우저에 저장한 여행을 JSON 파일로 백업하고 새 기기에서 여는 방법입니다.',
    body: '여행 화면에서 백업 메뉴를 열고 JSON 파일을 저장하세요. 한 여행을 내보내거나 전체 여행을 한 번에 백업할 수 있습니다. 새 브라우저의 푸터에서 백업 파일 불러오기를 선택하면 저장한 여행을 가져올 수 있습니다. 백업에는 메모, 지출, 체크리스트도 포함되므로 보관 위치와 전달 대상을 확인하세요.' },
];
