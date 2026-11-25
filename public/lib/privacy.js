// 개인정보처리방침 원본 (정적 페이지 /{lang}/privacy/ 한 곳에서 쓴다. 앱은 이 페이지로 링크한다, I-1).
import { CONTACT_EMAIL, SITE_ORIGIN } from './site-config.js';

const siteHost = new URL(SITE_ORIGIN).hostname;
// 바꿀 때 확인할 것: 외부 요청(지도 타일·검색·날씨·환율·CDN), 공유 링크에 담기는 필드(share.js shareSnapshot),
// 짧은 링크 서버 유무(배포는 정적 호스팅이라 /api/share가 없다), 저장 키(store.js · i18n.js · weather.js).
// 문장은 이 파일 안에서 언어별로 둔다 (긴 문서라 messages.js의 짧은 문구와 따로 관리).

const UPDATED = '2026-11-24';

const DOC = {
  ko: (c) => [
    { title: '요약', body: [
      'XenoTravel은 회원가입·로그인 없이 쓰는 여행 플래너예요. 이름·이메일 같은 계정 정보를 받지 않아요.',
      '만든 여행은 이 브라우저에 저장되고, 앱이 운영자 서버로 자동으로 보내지 않아요. 지도·검색·날씨·환율·공유처럼 외부와 연결되는 기능을 쓸 때만 아래에 적은 정보가 해당 서비스로 전달돼요.',
    ] },
    { title: '1. 회원가입과 수집하는 정보', body: [
      '회원가입이 없어서 계정·연락처를 수집하지 않아요.',
      '사이트를 열면 호스팅 업체(Vercel)와 라이브러리 배포 서버(cdnjs, jsDelivr)가 일반적인 접속 기록(IP 주소, 브라우저 정보, 요청 시각 등)을 처리할 수 있어요. 보관 기간은 각 업체의 정책을 따라요.',
    ] },
    { title: '2. 여행 데이터 저장 방식 (이 브라우저)', body: [
      '여행 일정·숙소·항공편·메모·가계부·체크리스트는 브라우저 저장소(localStorage)의 xenotravel:v1에, 화면 설정과 언어는 xenotravel:prefs·xenotravel:lang에, 날씨 임시 저장분은 xenotravel:wx에 저장돼요.',
      '다른 브라우저나 기기와 자동으로 맞춰지지 않아요. 옮기려면 백업 파일(JSON)을 쓰세요. 오프라인에서 쓰도록 앱 파일은 브라우저 캐시(서비스 워커)에 저장돼요.',
      '같은 브라우저의 다른 사람이나 기기를 쓸 수 있는 사람은 이 데이터를 볼 수 있으니 공용 기기에서는 사용 후 지워 주세요.',
    ] },
    { title: '3. 외부 지도·검색 서비스로 전달되는 정보', body: [
      '아래 기능을 쓸 때 브라우저가 해당 서비스에 직접 요청하고, 서비스는 요청한 기기의 IP 주소와 함께 다음 정보를 받아요. 각 서비스의 보관·처리는 그 서비스의 정책을 따라요.',
      [
        '지도 바탕(Esri ArcGIS 타일): 보고 있는 지도 범위(좌표·확대 단계)',
        '장소 검색·좌표로 주소 찾기(Photon, komoot): 입력한 검색어, 지도 중심 좌표, 고른 위치의 좌표',
        '한국어 장소 검색·새 여행의 여행지 찾기(Nominatim, OpenStreetMap): 검색어 또는 여행지 이름, 지도 주변 범위, 화면 언어',
        'Day별 날씨(Open-Meteo): 숙소·장소·여행지 좌표와 여행 기간',
        '환율(ExchangeRate-API, open.er-api.com): 원화 기준 환율 요청만 보내요. 여행 내용은 보내지 않아요.',
        '길찾기·구글맵에서 열기 링크를 누르면 Google 지도로 이동하면서 그 장소의 좌표가 전달돼요.',
      ],
    ] },
    { title: '4. 공유 링크와 공유 사본', body: [
      '공유 링크에는 여행 제목·여행지·날짜, 장소(이름·주소·좌표·시간·링크·종류), 숙소, 항공편(편명·공항·시각)의 사본이 담겨요. 기본으로 메모와 항공편 예약번호는 빼고, 가계부·체크리스트는 넣지 않아요.',
      `현재 배포(${siteHost})에는 짧은 링크 서버가 없어서 사본을 링크 주소의 # 뒤에 담아요. 이 부분은 브라우저가 서버로 보내지 않지만, 링크를 가진 사람과 링크를 전달한 메신저·앱은 내용을 볼 수 있어요.`,
      '받은 사람이 ‘내 여행으로 저장’을 누르면 그 사람의 브라우저에 사본이 생겨요. 링크는 만든 시점의 사본이라 이후 수정은 반영되지 않아요.',
    ] },
    { title: '5. 백업 파일과 내보내기', body: [
      '백업 파일(JSON)에는 메모·가계부·체크리스트를 포함한 여행 전체가 담겨요. 엑셀·CSV·캘린더(.ics)·PDF와 함께 기기에 파일로 저장되고, 보관과 전달은 사용자가 정해요.',
    ] },
    { title: '6. 삭제 방법', body: [
      [
        '여행 하나: 여행 화면의 ⋯ 메뉴에서 ‘이 여행 삭제’, 또는 메인의 여행 카드에서 ✕를 누르세요.',
        '전부: 브라우저 설정에서 이 사이트의 쿠키 및 사이트 데이터(저장소)를 지우면 여행·설정·날씨 임시 저장·오프라인 파일이 모두 지워져요.',
      ],
      '지운 데이터는 되돌릴 수 없으니 필요하면 먼저 백업 파일을 저장하세요. 이미 보낸 공유 링크·백업 파일과 외부 서비스에 전달된 요청 기록은 이 방법으로 지워지지 않아요.',
    ] },
    { title: '7. 문의', body: [`개인정보 관련 문의: ${c}`, `개인정보 보호책임자: XenoTravel 운영팀 · ${c}`, `시행일: ${UPDATED}`] },
    { title: '8. 별도 설치본 (운영 서비스와 다름)', body: [`이 항목은 ${siteHost}이 아니라 코드를 받아 직접 운영하는 설치본에만 해당해요.`, '짧은 링크 서버(server.js)를 함께 운영하면 공유 링크를 만들 때 사본이 그 서버에 파일로 저장될 수 있고, 생성일로부터 180일 뒤 만료되어 삭제돼요. 운영자가 서버 접속 기록을 남길 수 있어요.'] },
  ],
  en: (c) => [
    { title: 'Summary', body: [
      'XenoTravel is a trip planner you use without signing up or logging in. We do not ask for account details such as your name or email.',
      'Trips you create are stored in this browser, and the app does not automatically send them to the operator’s server. Only when you use features that connect to outside services—maps, search, weather, exchange rates, sharing—is the information below passed to those services.',
    ] },
    { title: '1. Sign-up and information collected', body: [
      'There is no sign-up, so no account or contact details are collected.',
      'When you open the site, the hosting provider (Vercel) and library servers (cdnjs, jsDelivr) may process standard access logs (IP address, browser details, request time, etc.). Retention follows each provider’s policy.',
    ] },
    { title: '2. How trip data is stored (this browser)', body: [
      'Itineraries, stays, flights, notes, budgets, and checklists are stored in browser storage (localStorage) under xenotravel:v1; display settings and language under xenotravel:prefs and xenotravel:lang; cached weather under xenotravel:wx.',
      'Data is not synced to other browsers or devices. Use a backup file (JSON) to move it. App files are kept in the browser cache (service worker) so the app works offline.',
      'Anyone who can use this browser or device can see this data, so clear it after using a shared device.',
    ] },
    { title: '3. Information sent to external map and search services', body: [
      'When you use the features below, your browser contacts these services directly, and they receive your device’s IP address along with the following. Each service handles and retains data under its own policy.',
      [
        'Map tiles (Esri ArcGIS): the map area you are viewing (coordinates and zoom level)',
        'Place search and address lookup (Photon, komoot): your search text, the map center, and the coordinates you pick',
        'Korean place search and finding a new trip’s destination (Nominatim, OpenStreetMap): the search text or destination name, the area around the map, and the display language',
        'Daily weather (Open-Meteo): coordinates of stays, places, or the destination, and trip dates',
        'Exchange rates (ExchangeRate-API, open.er-api.com): only a request for KRW-based rates. No trip content is sent.',
        'Tapping Directions or Open in Google Maps takes you to Google Maps and passes that place’s coordinates.',
      ],
    ] },
    { title: '4. Share links and shared copies', body: [
      'A share link contains a copy of the trip title, destination, dates, places (name, address, coordinates, time, link, category), stays, and flights (flight number, airports, times). By default notes and booking references are excluded, and budgets and checklists are never included.',
      `The current deployment (${siteHost}) has no short-link server, so the copy is stored after the # in the link. Browsers do not send that part to the server, but anyone with the link—and any messenger or app you send it through—can see the contents.`,
      'When a recipient taps “Save as my trip,” a copy is created in their browser. A link is a snapshot, so later edits are not reflected.',
    ] },
    { title: '5. Backup files and exports', body: [
      'A backup file (JSON) contains the whole trip, including notes, budget, and checklist. Like Excel, CSV, calendar (.ics), and PDF exports, it is saved as a file on your device, and you decide where to keep or send it.',
    ] },
    { title: '6. How to delete data', body: [
      [
        'One trip: choose “Delete this trip” in the ⋯ menu on the trip screen, or tap ✕ on the trip card on the home page.',
        'Everything: clear this site’s cookies and site data (storage) in your browser settings. This removes all trips, settings, cached weather, and offline files.',
      ],
      'Deleted data cannot be recovered, so save a backup first if you need it. Share links or backup files you already sent, and request logs held by external services, are not removed this way.',
    ] },
    { title: '7. Contact', body: [`Privacy inquiries: ${c}`, `Privacy officer: XenoTravel team · ${c}`, `Effective date: ${UPDATED}`] },
    { title: '8. Self-hosted installations (not the official service)', body: [`This section applies only to installations someone runs from the source code—not to ${siteHost}.`, 'If the short-link server (server.js) is also run, creating a share link may store the copy as a file on that server, and it expires 180 days after creation and is deleted. Whoever runs it may keep server access logs.'] },
  ],
  zh: (c) => [
    { title: '摘要', body: [
      'XenoTravel 是一款无需注册或登录即可使用的旅行规划工具，不会收集姓名、电子邮件等账户信息。',
      '你创建的行程保存在当前浏览器中，应用不会自动发送到运营方服务器。只有在使用地图、搜索、天气、汇率、分享等需要连接外部的功能时，下列信息才会传给相应服务。',
    ] },
    { title: '1. 注册与收集的信息', body: [
      '没有注册功能，因此不收集账户或联系方式。',
      '打开网站时，托管服务商（Vercel）和程序库分发服务器（cdnjs、jsDelivr）可能会处理一般访问记录（IP 地址、浏览器信息、请求时间等），保存期限依各服务商政策而定。',
    ] },
    { title: '2. 行程数据的保存方式（当前浏览器）', body: [
      '行程、住宿、航班、备注、记账和清单保存在浏览器存储（localStorage）的 xenotravel:v1 中；显示设置和语言保存在 xenotravel:prefs、xenotravel:lang 中；天气缓存保存在 xenotravel:wx 中。',
      '数据不会自动同步到其他浏览器或设备，如需迁移请使用备份文件（JSON）。为支持离线使用，应用文件会保存在浏览器缓存（Service Worker）中。',
      '能使用此浏览器或设备的人都可以看到这些数据，在公用设备上使用后请删除。',
    ] },
    { title: '3. 传给外部地图和搜索服务的信息', body: [
      '使用下列功能时，浏览器会直接向相应服务发出请求，服务会收到你设备的 IP 地址及以下信息。各服务依其自身政策处理和保存数据。',
      [
        '地图底图（Esri ArcGIS 瓦片）：正在查看的地图范围（坐标、缩放级别）',
        '地点搜索、按坐标查地址（Photon，komoot）：输入的搜索词、地图中心坐标、所选位置的坐标',
        '韩语地点搜索、查找新行程的目的地（Nominatim，OpenStreetMap）：搜索词或目的地名称、地图周边范围、界面语言',
        '每日天气（Open-Meteo）：住宿、地点或目的地的坐标和行程日期',
        '汇率（ExchangeRate-API，open.er-api.com）：只发送以韩元为基准的汇率请求，不发送行程内容。',
        '点击“路线”或“在 Google 地图中打开”会跳转到 Google 地图，并传递该地点的坐标。',
      ],
    ] },
    { title: '4. 分享链接与分享副本', body: [
      '分享链接包含行程标题、目的地、日期、地点（名称、地址、坐标、时间、链接、类别）、住宿和航班（航班号、机场、时间）的副本。默认不包含备注和航班预订号，记账和清单始终不包含。',
      `当前部署（${siteHost}）没有短链接服务器，副本保存在链接中 # 之后的部分。浏览器不会把这部分发送到服务器，但持有链接的人以及转发链接的即时通讯工具或应用都能看到内容。`,
      '接收者点击“保存到我的行程”后，会在其浏览器中生成副本。链接是创建时的快照，之后的修改不会同步。',
    ] },
    { title: '5. 备份文件与导出', body: [
      '备份文件（JSON）包含整个行程，包括备注、记账和清单。它与 Excel、CSV、日历（.ics）、PDF 一样以文件形式保存在你的设备上，由你决定如何保管和发送。',
    ] },
    { title: '6. 删除方法', body: [
      [
        '删除单个行程：在行程页面的 ⋯ 菜单中选择“删除此行程”，或在首页的行程卡片上点击 ✕。',
        '全部删除：在浏览器设置中清除本网站的 Cookie 和网站数据（存储），所有行程、设置、天气缓存和离线文件都会被删除。',
      ],
      '删除后无法恢复，如有需要请先保存备份文件。已发送的分享链接、备份文件以及外部服务的请求记录不会因此删除。',
    ] },
    { title: '7. 联系方式', body: [`个人信息相关咨询：${c}`, `个人信息保护负责人：XenoTravel 运营团队 · ${c}`, `生效日期：${UPDATED}`] },
    { title: '8. 自行部署的版本（不同于官方服务）', body: [`本节仅适用于他人用源代码自行部署运行的版本，不适用于 ${siteHost}。`, '如果同时运行短链接服务器（server.js），生成分享链接时副本可能以文件形式保存在该服务器上，副本在创建 180 天后过期并删除。部署者可能会保留服务器访问记录。'] },
  ],
  ja: (c) => [
    { title: '概要', body: [
      'XenoTravel は会員登録やログインなしで使える旅行プランナーです。氏名やメールアドレスなどのアカウント情報は受け取りません。',
      '作成した旅行はこのブラウザに保存され、アプリが運営者のサーバーへ自動で送信することはありません。地図・検索・天気・為替・共有など外部につながる機能を使うときだけ、下記の情報が各サービスに渡ります。',
    ] },
    { title: '1. 会員登録と収集する情報', body: [
      '会員登録がないため、アカウントや連絡先は収集しません。',
      'サイトを開くと、ホスティング事業者（Vercel）とライブラリ配信サーバー（cdnjs、jsDelivr）が一般的なアクセス記録（IP アドレス、ブラウザ情報、リクエスト日時など）を処理する場合があります。保存期間は各事業者のポリシーに従います。',
    ] },
    { title: '2. 旅行データの保存方法（このブラウザ）', body: [
      '旅程・宿・航空便・メモ・家計簿・チェックリストはブラウザのストレージ（localStorage）の xenotravel:v1 に、表示設定と言語は xenotravel:prefs・xenotravel:lang に、天気の一時保存は xenotravel:wx に保存されます。',
      'ほかのブラウザや端末とは自動で同期されません。移すときはバックアップファイル（JSON）を使ってください。オフラインで使えるよう、アプリのファイルはブラウザのキャッシュ（Service Worker）に保存されます。',
      'このブラウザや端末を使える人はこのデータを見られるため、共用の端末では使用後に削除してください。',
    ] },
    { title: '3. 外部の地図・検索サービスに渡る情報', body: [
      '以下の機能を使うと、ブラウザが各サービスへ直接リクエストし、サービスは端末の IP アドレスとともに次の情報を受け取ります。各サービスでの取り扱い・保存はそれぞれのポリシーに従います。',
      [
        '地図の背景（Esri ArcGIS タイル）：表示中の地図の範囲（座標・ズーム）',
        '場所検索・座標から住所の検索（Photon、komoot）：入力した検索語、地図の中心座標、選んだ位置の座標',
        '韓国語の場所検索・新しい旅行の目的地検索（Nominatim、OpenStreetMap）：検索語または目的地名、地図周辺の範囲、表示言語',
        '日ごとの天気（Open-Meteo）：宿・場所・目的地の座標と旅行日',
        '為替レート（ExchangeRate-API、open.er-api.com）：ウォン基準のレートの要求のみを送ります。旅行の内容は送りません。',
        '「経路」や「Google マップで開く」を押すと Google マップに移動し、その場所の座標が渡ります。',
      ],
    ] },
    { title: '4. 共有リンクと共有コピー', body: [
      '共有リンクには、旅行のタイトル・目的地・日付、場所（名前・住所・座標・時間・リンク・種類）、宿、航空便（便名・空港・時刻）のコピーが入ります。初期設定ではメモと予約番号を除き、家計簿とチェックリストは入りません。',
      `現在の公開版（${siteHost}）には短縮リンクのサーバーがないため、コピーはリンクの # 以降に入ります。この部分はブラウザがサーバーへ送りませんが、リンクを持つ人とリンクを送ったメッセンジャー・アプリは内容を見られます。`,
      '受け取った人が「自分の旅行に保存」を押すと、その人のブラウザにコピーが作られます。リンクは作成時点のコピーのため、その後の変更は反映されません。',
    ] },
    { title: '5. バックアップファイルとエクスポート', body: [
      'バックアップファイル（JSON）にはメモ・家計簿・チェックリストを含む旅行全体が入ります。Excel・CSV・カレンダー（.ics）・PDF と同様に端末にファイルとして保存され、保管や送信はご自身で決めます。',
    ] },
    { title: '6. 削除方法', body: [
      [
        '旅行を 1 件削除：旅行画面の ⋯ メニューで「この旅行を削除」を選ぶか、ホームの旅行カードの ✕ を押します。',
        'すべて削除：ブラウザの設定でこのサイトの Cookie とサイトデータ（ストレージ）を削除すると、旅行・設定・天気の一時保存・オフライン用ファイルがすべて削除されます。',
      ],
      '削除したデータは元に戻せないため、必要なら先にバックアップを保存してください。送信済みの共有リンク・バックアップファイルや、外部サービスに残るリクエスト記録はこの方法では削除されません。',
    ] },
    { title: '7. お問い合わせ', body: [`個人情報に関するお問い合わせ：${c}`, `個人情報保護責任者：XenoTravel 運営チーム · ${c}`, `施行日：${UPDATED}`] },
    { title: '8. 独自に設置した環境（公式サービスとは別）', body: [`この項目は ${siteHost} ではなく、ソースコードから独自に運用している環境にのみ当てはまります。`, '短縮リンクのサーバー（server.js）も運用している場合、共有リンクを作るとコピーがそのサーバーにファイルとして保存されることがあり、作成から180日後に有効期限が切れ、削除されます。運用者がサーバーのアクセス記録を残す場合があります。'] },
  ],
};

/** [{ title, body: [문단 | [목록]] }] — 지원하지 않는 언어는 한국어 */
const AD_SETTINGS = 'https://adssettings.google.com/';
const ADS = {
  ko: ['9. 광고 및 쿠키', '광고가 활성화되면 Google AdSense 및 제3자 광고 제공업체가 광고 게재와 측정을 위해 쿠키를 사용할 수 있어요. 맞춤 광고는 적용되는 동의 선택에 따르며, Google 광고 설정에서 끌 수 있어요.', 'Google 광고 설정'],
  en: ['9. Advertising and cookies', 'When ads are enabled, Google AdSense and third-party ad vendors may use cookies to serve and measure ads. Personalization follows applicable consent choices and can be turned off in Google Ads Settings.', 'Google Ads Settings'],
  zh: ['9. 广告与 Cookie', '启用广告后，Google AdSense 和第三方广告供应商可能使用 Cookie 投放和衡量广告。个性化广告遵循适用的同意选择，你也可以在 Google 广告设置中关闭。', 'Google 广告设置'],
  ja: ['9. 広告と Cookie', '広告が有効な場合、Google AdSense と第三者広告配信事業者が広告の配信や測定に Cookie を使うことがあります。パーソナライズは適用される同意設定に従い、Google の広告設定で無効にできます。', 'Google の広告設定'],
};

export function privacySections(lang, { contact = CONTACT_EMAIL } = {}) {
  const key = Object.hasOwn(DOC, lang) ? lang : 'ko';
  const [title, description, label] = ADS[key];
  return [...DOC[key](contact), { title, body: [description], link: { href: AD_SETTINGS, label } }];
}

const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => entities[c]);

export function renderPrivacySections(sections, { modal = false } = {}) {
  const heading = modal ? 'h3' : 'h2';
  return sections.map((s, i) => `<section id="pv-${i}"${modal ? ' tabindex="-1"' : ''}><${heading}>${escapeHtml(s.title)}</${heading}>${
    s.body.map((p) => Array.isArray(p)
      ? `<ul>${p.map((li) => `<li>${escapeHtml(li)}</li>`).join('')}</ul>`
      : `<p>${escapeHtml(p)}</p>`).join('')
  }${s.link ? `<p><a href="${escapeHtml(s.link.href)}">${escapeHtml(s.link.label)}</a></p>` : ''}</section>`).join('');
}
