import {
  ArrowRight,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  ClipboardList,
  Download,
  MapPinned,
  MessageCircle,
  Pause,
  PencilLine,
  Play,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Store,
} from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import kuchitoruLogo from '../../assets/brand/kuchitoru-zero-logo.png'
import { useI18n } from '../../shared/i18n'
import { AppFooter, BrandMark } from '../../shared/ui/ui'

const problemsJa = [
  'アンケートを置いても、なかなか回答が集まらない',
  '口コミをお願いするのが、スタッフの負担になっている',
  '集めた声を、お店の改善に活かしきれていない',
]

const problemIcons = [Smartphone, ClipboardList, BarChart3]

const featuresJa = [
  {
    icon: ShieldCheck,
    title: '評価で誘導を変えない',
    body: '回答内容や評価にかかわらず、同じ流れをご案内します。良い声だけを選別しません。',
  },
  {
    icon: PencilLine,
    title: '最後に決めるのはお客様',
    body: '口コミ文は本人が確認・編集できます。投稿するかどうかも、お客様自身が選べます。',
  },
  {
    icon: BarChart3,
    title: '声を改善につなげる',
    body: '回答は店舗の管理画面にまとまり、日々の接客やサービス改善に活用できます。',
  },
]

const faqsJa = [
  ['利用に費用はかかりますか？', 'ソースコードはAGPL-3.0-or-laterで公開されています。運用するサーバーや、接続する外部サービスの利用料は運用者が負担します。'],
  ['お客様は会員登録が必要ですか？', '必要ありません。店頭のQRコードを読み取り、そのままアンケートに回答できます。'],
  ['作られた口コミ文は自動投稿されますか？', '自動では投稿されません。回答したお客様が文章を確認・編集し、投稿するかどうかを決めます。'],
  ['悪い評価も集められますか？', 'はい。評価や回答内容によって案内する流れを変えず、良かった点も改善してほしい点も受け取ります。'],
  ['AIのAPIキーがなくても使えますか？', 'アンケートの収集や回答データの書き出しは利用できます。AIによる文章生成には、店舗管理者が対応プロバイダーのAPIキーを接続してください。'],
  ['口コミ文は確認・編集できますか？', 'はい。回答したお客様本人が内容を確認し、自由に編集できます。'],
  ['アンケートは何問ですか？', 'アンケートは5問です。来店頻度や評価など、答えなくてもよい質問もあります。'],
  ['どんな店舗で使えますか？', '飲食店、美容・サロン、クリニック、士業、宿泊施設、小売店などで利用できます。その他のサービスにも対応しています。'],
  ['店舗では何を確認できますか？', '店舗の管理画面で、届いた回答の履歴を確認できます。月ごとの傾向も見られます。'],
  ['回答データを書き出せますか？', 'はい。CSVや分析用のファイルとして書き出せます。'],
  ['導入はどう進めますか？', '店舗登録後、店舗用のQRコードを卓上POPやレシートなどで案内します。お客様はQRコードから5問のアンケートに回答します。'],
]

const useCasesJa = [
  { icon: QrCode, label: '店舗ごとのQRコードを作成' },
  { icon: ClipboardList, label: '5問のかんたんアンケート' },
  { icon: PencilLine, label: '回答に忠実な口コミ文を作成' },
  { icon: MessageCircle, label: '回答履歴を一覧で確認' },
  { icon: BarChart3, label: '月次の傾向を集計' },
  { icon: Download, label: 'CSV・分析用ファイルを書き出し' },
]

const industriesJa = ['飲食店', '美容・サロン', 'クリニック', '士業', '宿泊施設', '小売店', 'その他サービス']


const problemsEn = ['Surveys are available, but responses remain scarce', 'Asking for reviews burdens staff', 'Collected feedback is not fully used for improvement']
const featuresEn = [
 { icon: ShieldCheck, title: 'No rating-based routing', body: 'Every rating and response follows the same flow. Positive feedback is not selectively filtered.' },
 { icon: PencilLine, title: 'The customer makes the final decision', body: 'Customers review and edit the text and choose whether to post it.' },
 { icon: BarChart3, title: 'Turn feedback into improvements', body: 'Responses are organized in the store dashboard for service improvements.' },
]
const faqsEn = [
 ['What does it cost to use?', 'The source code is available under AGPL-3.0-or-later. Operators pay for their own infrastructure and connected external services.'], ['Do customers need an account?', 'No. They answer directly from the in-store QR code.'], ['Is created review text posted automatically?', 'No. Customers review and edit it and decide whether to post.'], ['Can low ratings be collected?', 'Yes. The flow does not change by rating or response content.'], ['Can I use it without an AI API key?', 'Survey collection and data export remain available. AI text generation requires the store owner to connect a supported provider API key.'], ['Can review text be reviewed and edited?', 'Yes. The respondent can review and freely edit it.'], ['How many questions are there?', 'Five. Visit frequency and rating can be skipped.'], ['What types of stores can use it?', 'Restaurants, salons, clinics, professional offices, lodging, retail, and other services.'], ['What can stores review?', 'Response history and monthly trends in the dashboard.'], ['Can response data be exported?', 'Yes, as CSV and analysis files.'], ['How do I get started?', 'Register a store, place its QR code on table signs or receipts, and customers answer five questions.']]
const useCasesEn = [
 { icon: QrCode, label: 'Create a QR code for each store' }, { icon: ClipboardList, label: 'Simple five-question survey' }, { icon: PencilLine, label: 'Shape review text faithful to answers' }, { icon: MessageCircle, label: 'Review response history' }, { icon: BarChart3, label: 'Aggregate monthly trends' }, { icon: Download, label: 'Export CSV and analysis files' },
]
const industriesEn = ['Restaurants', 'Beauty and salons', 'Clinics', 'Professional services', 'Lodging', 'Retail', 'Other services']
const COMMUNITY_ISSUES_URL = 'https://github.com/yoshi0703/kuchitoru-zero-oss/issues'
const COMMUNITY_SECURITY_URL = 'https://github.com/yoshi0703/kuchitoru-zero-oss/security/advisories/new'
const HOSTED_CONTACT_URL = 'https://app.kuchitoru.com/contact'

function PublicHeader({ contact = false }: { contact?: boolean }) {
  const { locale, text } = useI18n()
  return (
    <header className="landing__header">
      <div className="landing__corner" aria-hidden="true" />
      <div className="landing__mobile-brand">{locale === 'ja' ? <BrandMark /> : <Link className="brand" to="/" aria-label="Kuchitoru Zero home"><img className="brand__logo" src={kuchitoruLogo} alt="" /></Link>}</div>
      <nav aria-label={text({ ja: 'メインナビゲーション', en: 'Main navigation' })}>
        {contact ? <Link to="/">{text({ ja: '総合TOP', en: 'Home' })}</Link> : <a href="#top">{text({ ja: '総合TOP', en: 'Home' })}</a>}
        <a href={contact ? '/#features' : '#features'}>{text({ ja: '特徴', en: 'Features' })}</a>
        <a href={contact ? '/#outcomes' : '#outcomes'}>{text({ ja: '導入効果', en: 'Benefits' })}</a>
        <a href={contact ? '/#community' : '#community'}>{text({ ja: 'Community版', en: 'Community' })}</a>
        <a href={contact ? '/#faq' : '#faq'}>{text({ ja: 'よくある質問', en: 'FAQ' })}</a>
        <Link aria-current={contact ? 'page' : undefined} className="landing__contact-link" to="/contact">{text({ ja: 'サポート', en: 'Support' })}</Link>
        <Link className="landing__login" to="/login">{text({ ja: 'ログイン', en: 'Sign in' })}</Link>
      </nav>
    </header>
  )
}

export function LandingPage() {
  const { locale, text } = useI18n()
  const problems = locale === 'ja' ? problemsJa : problemsEn
  const features = locale === 'ja' ? featuresJa : featuresEn
  const faqs = locale === 'ja' ? faqsJa : faqsEn
  const useCases = locale === 'ja' ? useCasesJa : useCasesEn
  const industries = locale === 'ja' ? industriesJa : industriesEn
  const prefersReducedMotion = useReducedMotion()
  const [showAllFaqs, setShowAllFaqs] = useState(false)
  const [industriesPaused, setIndustriesPaused] = useState(false)

  return (
    <main className="landing">
      <div className="landing__layout">
        <div className="landing__main">
          <PublicHeader />

          <section className="landing__hero" id="top" aria-labelledby="landing-title">
            <div className="landing__hero-copy">
              <h1 id="landing-title">{locale === 'ja' ? <>お客様の声を、<br />次のお店づくりへ。</> : <>Turn customer experiences into words<br />that improve the next visit.</>}</h1>
              <p>{text({ ja: 'QRコードから、かんたんアンケート。回答者本人が確認した言葉だけを、次の改善へつなげます。', en: 'A simple QR-code survey turns only customer-reviewed words into the next improvement.' })}</p>
              <p className="landing__microcopy">{text({ ja: '自分の環境に導入して運用できます。', en: 'Deploy and run it in your own environment.' })}</p>
              <div className="button-row">
                <Link className="button button--primary landing__primary-cta" to="/register">{text({ ja: 'アカウントを作成', en: 'Create account' })} <ArrowRight aria-hidden="true" /></Link>
              </div>
            </div>
            <div className="landing__hero-visual" aria-label={text({ ja: 'QRアンケートからお客様の声を集める流れ', en: 'Collecting customer feedback through a QR survey' })}>
              <QrCode className="landing__hero-symbol" aria-hidden="true" />
            </div>
          </section>

          <section className="landing__problems" aria-labelledby="problems-title">
            <h2 id="problems-title">{text({ ja: 'こんなお悩みありませんか？', en: 'Does this sound familiar?' })}</h2>
            <div className="landing__problem-list">
              {problems.map((problem, index) => {
                const ProblemIcon = problemIcons[index] ?? MessageCircle
                return <article key={problem}>
                  <span aria-hidden="true">0{index + 1}</span>
                  <h3>{problem}</h3>
                  <ProblemIcon className="landing__problem-icon" aria-hidden="true" />
                </article>
              })}
            </div>
          </section>

          <section className="landing__solution" aria-labelledby="solution-title">
            <p>{text({ ja: 'そのお悩み、', en: 'Those challenges,' })}</p>
            <h2 id="solution-title">{text({ ja: 'クチトルZeroが解決します。', en: 'Kuchitoru Zero provides a solution.' })}</h2>
            <motion.div
              className="landing__conversation"
              aria-label={text({ ja: 'お客様の声が届くイメージ', en: 'Illustration of customer feedback arriving' })}
              initial={prefersReducedMotion ? 'visible' : 'hidden'}
              whileInView="visible"
              viewport={{ once: true, amount: 0.55 }}
              variants={{ visible: { transition: { staggerChildren: 0.16, delayChildren: 0.05 } } }}
            >
              <motion.div
                className="landing__conversation-row"
                variants={{ hidden: { opacity: 0, x: -24, y: 10 }, visible: { opacity: 1, x: 0, y: 0, transition: { duration: 0.42, ease: [0.23, 1, 0.32, 1] } } }}
              >
                <span aria-hidden="true">🙋</span>
                <p>{text({ ja: '雰囲気もスタッフさんも素敵でした。でも、料理を待つ時間が少し長く感じました。', en: 'The atmosphere and staff were wonderful, but the wait for food felt a little long.' })}</p>
              </motion.div>
              <motion.div
                className="landing__conversation-row landing__conversation-row--answer"
                variants={{ hidden: { opacity: 0, x: 24, y: 10 }, visible: { opacity: 1, x: 0, y: 0, transition: { duration: 0.42, ease: [0.23, 1, 0.32, 1] } } }}
              >
                <p><strong>{text({ ja: 'クチトルZero', en: 'Kuchitoru Zero' })}</strong><br />{text({ ja: '率直な気持ちを教えていただき、ありがとうございます。「素敵だったこと」も「少し気になったこと」も、どちらも大切にして文章にまとめました。違うと感じたところは、自由に直せます。', en: 'Thank you for sharing honestly. We shaped both the highlights and concerns into text you can freely edit.' })}</p>
                <span className="landing__conversation-logo" aria-hidden="true"><img src={kuchitoruLogo} alt="" /></span>
              </motion.div>
              <motion.div
                className="landing__conversation-row"
                variants={{ hidden: { opacity: 0, x: -24, y: 10 }, visible: { opacity: 1, x: 0, y: 0, transition: { duration: 0.42, ease: [0.23, 1, 0.32, 1] } } }}
              >
                <span aria-hidden="true">🙋</span>
                <p>{text({ ja: 'これなら、お店へのありがとうも、次はもっと良くなってほしい気持ちも伝えられそうです。', en: 'This lets me share both my thanks and what could be even better next time.' })}</p>
              </motion.div>
            </motion.div>
          </section>

          <section className="landing__workflow" id="how-it-works" aria-labelledby="workflow-title">
            <header className="landing__section-heading">
              <h2 id="workflow-title">{text({ ja: 'お客様の言葉が届くまで', en: 'How customer feedback reaches you' })}</h2>
              <p>{text({ ja: '店頭でのご案内から、回答の確認まで。流れは3ステップです。', en: 'From the in-store prompt to reviewing answers, the flow has three steps.' })}</p>
            </header>
            <div className="landing__workflow-row">
              <div className="landing__workflow-copy"><span>STEP 1</span><h3>{text({ ja: 'QRコードをご案内', en: 'Present the QR code' })}</h3><p>{text({ ja: '店舗ごとのQRコードを、卓上POPやレシートに掲載。お客様はスマートフォンからすぐに回答できます。', en: 'Place each store’s QR code on table signs or receipts so customers can answer by phone.' })}</p></div>
              <div className="landing__workflow-image"><QrCode aria-hidden="true" /></div>
            </div>
            <div className="landing__workflow-row landing__workflow-row--reverse">
              <div className="landing__workflow-copy"><span>STEP 2</span><h3>{text({ ja: 'かんたんな質問に回答', en: 'Answer simple questions' })}</h3><p>{text({ ja: '良かった点も、気になった点も、固定設問に沿って回答。会員登録は必要ありません。', en: 'Customers answer standard questions about highlights and concerns. No account is required.' })}</p></div>
              <div className="landing__workflow-image landing__workflow-image--mint"><ClipboardList aria-hidden="true" /></div>
            </div>
            <div className="landing__workflow-row">
              <div className="landing__workflow-copy"><span>STEP 3</span><h3>{text({ ja: '本人が文章を確認', en: 'The customer reviews the text' })}</h3><p>{text({ ja: '回答内容に忠実な口コミ文を作成。お客様が確認・編集し、投稿するかどうかまで自分で決められます。', en: 'Review text stays faithful to answers. Customers review, edit, and decide whether to post.' })}</p></div>
              <div className="landing__workflow-image landing__workflow-image--coral"><PencilLine aria-hidden="true" /></div>
            </div>
          </section>

          <section className="landing__features" id="features" aria-labelledby="features-title">
            <header className="landing__section-heading landing__section-heading--light">
              <h2 id="features-title">{text({ ja: 'クチトルZeroの3つの特徴', en: 'Three Kuchitoru Zero principles' })}</h2>
              <p>{text({ ja: '口コミを増やすことだけを目的にしない、誠実な体験設計です。', en: 'An honest experience designed for more than simply increasing reviews.' })}</p>
            </header>
            <div className="landing__feature-list">
              {features.map(({ icon: Icon, title, body }, index) => (
                <article key={title}>
                  <span className="landing__feature-number">0{index + 1}</span>
                  <span className="landing__feature-icon" aria-hidden="true"><Icon /></span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="landing__comparison" id="trust" aria-labelledby="comparison-title">
            <header className="landing__section-heading">
              <h2 id="comparison-title">{text({ ja: 'よくある口コミ施策との違い', en: 'How it differs from common review campaigns' })}</h2>
              <p>{text({ ja: '集め方だけでなく、お客様が安心して答えられることを大切にしています。', en: 'The experience prioritizes customers feeling safe to answer.' })}</p>
            </header>
            <div className="landing__table-wrap">
              <table>
                <thead><tr><th>{text({ ja: '比較項目', en: 'Comparison' })}</th><th>{text({ ja: '一般的な口コミ依頼', en: 'Typical review request' })}</th><th>{text({ ja: 'クチトルZero', en: 'Kuchitoru Zero' })}</th></tr></thead>
                <tbody>
                  <tr><th>{text({ ja: '回答の入口', en: 'How customers start' })}</th><td>{text({ ja: 'スタッフから直接お願い', en: 'Direct staff request' })}</td><td>{text({ ja: 'QRコードからお客様のタイミングで', en: 'QR code, at the customer’s convenience' })}</td></tr>
                  <tr><th>{text({ ja: '評価による出し分け', en: 'Rating-based routing' })}</th><td>{text({ ja: '施策によっては変わる', en: 'May vary' })}</td><td><span className="landing__comparison-positive"><CheckCircle2 aria-hidden="true" />{text({ ja: '変えない', en: 'Never changes' })}</span></td></tr>
                  <tr><th>{text({ ja: '口コミ文の確認', en: 'Reviewing the text' })}</th><td>{text({ ja: 'お客様が最初から作成', en: 'Customer writes from scratch' })}</td><td><span className="landing__comparison-positive"><CheckCircle2 aria-hidden="true" />{text({ ja: 'AIが整え、本人が確認・編集', en: 'AI shapes it; customer reviews and edits' })}</span></td></tr>
                  <tr><th>{text({ ja: '投稿の判断', en: 'Posting decision' })}</th><td>{text({ ja: '投稿を強くお願いする場合も', en: 'May strongly encourage posting' })}</td><td><span className="landing__comparison-positive"><CheckCircle2 aria-hidden="true" />{text({ ja: '最後までお客様が選択', en: 'Customer chooses throughout' })}</span></td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="landing__outcomes" id="outcomes" aria-labelledby="outcomes-title">
            <header className="landing__section-heading landing__section-heading--center">
              <h2 id="outcomes-title">{text({ ja: '導入効果', en: 'Benefits' })}</h2>
              <p>{text({ ja: '集めるだけで終わらせず、お客様の声を次の店舗改善へつなげます。', en: 'Connect customer feedback to store improvements rather than merely collecting it.' })}</p>
            </header>
            <div>
              <article><MessageCircle aria-hidden="true" /><h3>{text({ ja: '話しやすい', en: 'Easy to share' })}</h3><p>{text({ ja: '対面で言いづらいことも、スマートフォンから落ち着いて回答できます。', en: 'Customers can calmly share things that are difficult to say face to face.' })}</p></article>
              <article><Store aria-hidden="true" /><h3>{text({ ja: '受け取りやすい', en: 'Easy to receive' })}</h3><p>{text({ ja: '店舗ごとに回答をまとめ、日々の接客や運営を振り返れます。', en: 'Responses are organized by store for daily reflection.' })}</p></article>
              <article><BarChart3 aria-hidden="true" /><h3>{text({ ja: '改善しやすい', en: 'Easy to improve' })}</h3><p>{text({ ja: '褒め言葉だけでなく、改善意見も次のアクションにつなげられます。', en: 'Turn both praise and improvement feedback into action.' })}</p></article>
            </div>
          </section>

          <section className="landing__use-cases" aria-labelledby="use-cases-title">
            <header className="landing__section-heading landing__section-heading--center">
              <h2 id="use-cases-title">{text({ ja: '具体的な活用例', en: 'Practical uses' })}</h2>
              <p>{text({ ja: 'クチトルZeroは、声を集めるところから振り返りまでを一つにつなぎます。', en: 'Kuchitoru Zero connects collecting feedback through reviewing it.' })}</p>
            </header>
            <div className="landing__use-case-grid">
              {useCases.map(({ icon: Icon, label }) => (
                <article key={label}><Icon aria-hidden="true" /><h3>{label}</h3></article>
              ))}
            </div>
          </section>

          <section className="landing__industries" aria-labelledby="industries-title">
            <h2 id="industries-title">{text({ ja: '幅広い店舗・サービスに対応', en: 'Built for many stores and services' })}</h2>
            <p>{text({ ja: '業種ごとに用意したアンケートテンプレートから始められます。', en: 'Start with survey templates prepared for each industry.' })}</p>
            <div className="landing__industry-marquee">
              <div className={`landing__industry-track${industriesPaused ? ' landing__industry-track--paused' : ''}`}>
                <div className="landing__industry-group">
                  {industries.map((industry) => <span key={industry}>{industry}</span>)}
                </div>
                <div className="landing__industry-group landing__industry-group--clone" aria-hidden="true">
                  {industries.map((industry) => <span key={industry}>{industry}</span>)}
                </div>
              </div>
            </div>
            <button
              className="landing__industry-motion-toggle"
              type="button"
              aria-pressed={industriesPaused}
              onClick={() => setIndustriesPaused((current) => !current)}
            >
              {industriesPaused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
              {industriesPaused ? text({ ja: 'スクロールを再開', en: 'Resume scrolling' }) : text({ ja: 'スクロールを停止', en: 'Pause scrolling' })}
            </button>
          </section>

          <section className="landing__survey-preview" aria-labelledby="survey-preview-title">
            <div className="landing__survey-copy">
              <span className="landing__eyebrow">{text({ ja: '実際の画面', en: 'See it in action' })}</span>
              <h2 id="survey-preview-title">{text({ ja: '60秒アンケート', en: '60-second survey' })}</h2>
              <p>{text({ ja: 'QRから開いて、回答するだけ。お客様の声を、自然な言葉で残せます。', en: 'Open from a QR code and answer to preserve feedback in natural words.' })}</p>
              <span className="landing__survey-note"><Check aria-hidden="true" />{text({ ja: ' 回答者の登録は不要', en: ' No respondent registration required' })}</span>
            </div>
            <div className="landing__survey-stage">
              <SurveyPreviewMock />
            </div>
          </section>

          <section className="landing__price" id="community" aria-labelledby="community-title">
            <header className="landing__section-heading landing__section-heading--center">
              <h2 id="community-title">{text({ ja: '自分の環境で運用できるCommunity版', en: 'A self-hosted Community edition' })}</h2>
              <p><strong>{text({ ja: 'ソースコードを確認し、自社の環境に導入できます。', en: 'Review the source and run it in your own environment.' })}</strong><br />{text({ ja: 'AI機能は、店舗管理者が接続した外部AIプロバイダーだけを利用します。', en: 'AI features use only the external provider connected by the store owner.' })}</p>
            </header>
            <ul>
              <li><CheckCircle2 aria-hidden="true" />{text({ ja: ' AGPL-3.0-or-laterで公開', en: ' Released under AGPL-3.0-or-later' })}</li>
              <li><CheckCircle2 aria-hidden="true" />{text({ ja: ' 店舗管理者のAPIキーでAI接続', en: ' Owner-managed API keys for AI connections' })}</li>
              <li><CheckCircle2 aria-hidden="true" />{text({ ja: ' QR・回答履歴・月次集計を利用可能', en: ' QR codes, response history, and monthly totals included' })}</li>
            </ul>
            <p className="landing__price-note">{text({ ja: 'サーバー、Google・Meta・AIプロバイダーなど外部サービスの契約と利用料は、運用者が管理します。', en: 'Operators manage contracts and usage fees for infrastructure and external services such as Google, Meta, and AI providers.' })}</p>
            <Link className="button button--primary" to="/register">{text({ ja: 'アカウントを作成 ', en: 'Create account ' })}<ArrowRight aria-hidden="true" /></Link>
          </section>

          <section className="landing__faq" id="faq" aria-labelledby="faq-title">
            <header className="landing__section-heading">
              <h2 id="faq-title">{text({ ja: 'よくあるご質問', en: 'Frequently asked questions' })}</h2>
              <p>{text({ ja: 'ご利用前に確認したいことをまとめました。', en: 'Answers to common questions before getting started.' })}</p>
            </header>
            <div className="landing__faq-list">
              {faqs.slice(0, showAllFaqs ? faqs.length : 4).map(([question, answer]) => (
                <details key={question}>
                  <summary>
                    <span className="landing__faq-question"><span aria-hidden="true">Q.</span>{question}</span>
                    <ChevronDown aria-hidden="true" />
                  </summary>
                  <div className="landing__faq-answer"><span aria-hidden="true">A.</span><p>{answer}</p></div>
                </details>
              ))}
            </div>
            <button
              className="button landing__faq-more"
              type="button"
              aria-expanded={showAllFaqs}
              onClick={() => setShowAllFaqs((current) => !current)}
            >
              {showAllFaqs ? text({ ja: '閉じる', en: 'Close' }) : text({ ja: '詳細を見る', en: 'View details' })}
              <ChevronDown aria-hidden="true" />
            </button>
          </section>

          <section className="landing__final-cta" aria-labelledby="final-cta-title">
            <motion.div
              className="landing__final-cta-content"
              initial={prefersReducedMotion ? false : { opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.55 }}
              transition={{ duration: 0.55, ease: [0.23, 1, 0.32, 1] }}
            >
              <h2 id="final-cta-title">{text({ ja: 'お客様の声を、今日から集めませんか？', en: 'Start collecting customer feedback today.' })}</h2>
              <p>{text({ ja: '店舗管理者が自分の環境とAPI接続を管理します。', en: 'Store owners control their own environment and API connections.' })}</p>
            </motion.div>
            <motion.div
              className="landing__final-button-wrap"
              initial={prefersReducedMotion ? false : { opacity: 0, y: 34, scale: 0.9 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: true, amount: 0.55 }}
              transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.12 }}
            >
              <Link className="button landing__final-button" to="/register">{text({ ja: 'アカウントを作成 ', en: 'Create account ' })}<ArrowRight aria-hidden="true" /></Link>
            </motion.div>
          </section>

          <AppFooter />
        </div>

      </div>

      <div className="landing__mobile-cta">
        <Link className="button button--primary" to="/register">{text({ ja: 'アカウントを作成 ', en: 'Create account ' })}<ArrowRight aria-hidden="true" /></Link>
      </div>
    </main>
  )
}

export function ContactPage() {
  const { text } = useI18n()

  useEffect(() => {
    const previousTitle = document.title
    document.title = text({ ja: 'サポート | クチトルZero', en: 'Support | Kuchitoru Zero' })
    return () => { document.title = previousTitle }
  }, [text])

  return (
    <main className="landing contact-page">
      <PublicHeader contact />
      <section className="contact-page__intro" aria-labelledby="contact-title">
        <div className="contact-page__copy">
          <p className="contact-page__lead">{text({ ja: '用途に合った窓口を選んでください。', en: 'Choose the support channel that matches your request.' })}</p>
          <h1 id="contact-title">{text({ ja: 'サポート', en: 'Support' })}</h1>
          <p>{text({ ja: 'Community版とHosted版では、問い合わせ先とサポート範囲が異なります。この画面から個人情報を送信することはありません。', en: 'The Community and Hosted editions have separate support channels. This page does not submit personal information.' })}</p>
        </div>

        <div className="contact-page__form-wrap">
          <h2>{text({ ja: 'Community版', en: 'Community edition' })}</h2>
          <p>{text({ ja: '不具合や改善提案はGitHub Issuesで受け付けます。自己ホスト環境の個別構築・監視・バックアップは運用者の責任範囲です。', en: 'Report bugs and request improvements through GitHub Issues. Operators remain responsible for their own hosting, monitoring, and backups.' })}</p>
          <a className="button button--primary" href={COMMUNITY_ISSUES_URL} target="_blank" rel="noopener noreferrer">GitHub Issues</a>
          <h2>{text({ ja: '脆弱性の報告', en: 'Security reports' })}</h2>
          <p>{text({ ja: '脆弱性は公開Issueへ書かず、GitHubの非公開Security Advisoryから報告してください。', en: 'Do not disclose vulnerabilities in a public issue. Use GitHub private vulnerability reporting.' })}</p>
          <a className="button button--secondary" href={COMMUNITY_SECURITY_URL} target="_blank" rel="noopener noreferrer">{text({ ja: '非公開で報告する', en: 'Report privately' })}</a>
          <h2>{text({ ja: 'Hosted版', en: 'Hosted edition' })}</h2>
          <p>{text({ ja: 'クチトルZero Hosted版の契約やアカウントについては、Hosted版のお問い合わせ窓口を利用してください。', en: 'For Hosted-edition contracts or accounts, use the Hosted support channel.' })}</p>
          <a className="button button--secondary" href={HOSTED_CONTACT_URL}>{text({ ja: 'Hosted版へ問い合わせる', en: 'Contact Hosted support' })}</a>
        </div>
      </section>
      <AppFooter />
    </main>
  )
}

type SurveyMockMode = 'survey' | 'review'

const SURVEY_PREVIEW_REVIEW = '季節限定のカフェラテと自家製チーズケーキをいただき、窓際の席でゆっくり過ごしました。スタッフさんがメニューの甘さやおすすめの組み合わせを丁寧に説明してくださり、初めての利用でも安心できました。店内は落ち着いた雰囲気で、また立ち寄りたいと思えるお店です。入口付近に席の案内や注文方法がもう少し大きく表示されると、初めての方にもさらに分かりやすいと思います。'
const SURVEY_PREVIEW_REVIEW_EN = 'I enjoyed the seasonal café latte and homemade cheesecake by the window. The staff carefully explained the menu and made my first visit comfortable. Larger entrance signs would make seating and ordering even clearer.'
const SURVEY_SERVICE_JA = '季節限定のカフェラテと自家製チーズケーキを注文し、窓際の席を利用しました。'
const SURVEY_SERVICE_EN = 'I ordered the seasonal café latte and homemade cheesecake and sat by the window.'
const SURVEY_MEMORABLE_JA = 'スタッフさんがメニューの甘さやおすすめの組み合わせを丁寧に説明してくれました。店内は落ち着いた雰囲気で、初めてでもゆっくり過ごせました。'
const SURVEY_MEMORABLE_EN = 'The staff carefully explained the sweetness and recommended pairing. The calm atmosphere made my first visit comfortable.'
const SURVEY_IMPROVEMENT_JA = '入口付近に席の案内や注文方法がもう少し大きく表示されていると、初めての人にもさらに分かりやすいと思います。'
const SURVEY_IMPROVEMENT_EN = 'Larger signs near the entrance would make seating and ordering clearer for first-time visitors.'

export function SurveyPreviewMock() {
  const { locale, text } = useI18n()
  const [mode, setMode] = useState<SurveyMockMode>('survey')
  const [visitFrequency, setVisitFrequency] = useState<'first' | 'occasional' | 'regular' | 'unknown'>('unknown')
  const [rating, setRating] = useState<number | 'skip' | null>(null)
  const [serviceUsed, setServiceUsed] = useState(locale === 'ja' ? SURVEY_SERVICE_JA : SURVEY_SERVICE_EN)
  const [memorablePoints, setMemorablePoints] = useState(locale === 'ja' ? SURVEY_MEMORABLE_JA : SURVEY_MEMORABLE_EN)
  const [improvementPoints, setImprovementPoints] = useState(locale === 'ja' ? SURVEY_IMPROVEMENT_JA : SURVEY_IMPROVEMENT_EN)
  const [reviewText, setReviewText] = useState(locale === 'ja' ? SURVEY_PREVIEW_REVIEW : SURVEY_PREVIEW_REVIEW_EN)
  const [message, setMessage] = useState('')

  const reset = () => {
    setMode('survey')
    setVisitFrequency('unknown')
    setRating(null)
    setServiceUsed(locale === 'ja' ? SURVEY_SERVICE_JA : SURVEY_SERVICE_EN)
    setMemorablePoints(locale === 'ja' ? SURVEY_MEMORABLE_JA : SURVEY_MEMORABLE_EN)
    setImprovementPoints(locale === 'ja' ? SURVEY_IMPROVEMENT_JA : SURVEY_IMPROVEMENT_EN)
    setReviewText(locale === 'ja' ? SURVEY_PREVIEW_REVIEW : SURVEY_PREVIEW_REVIEW_EN)
    setMessage('')
  }

  const submitSurvey = () => {
    if (!serviceUsed.trim() || !memorablePoints.trim()) return
    setMode('review')
    setMessage('')
  }

  const copyReview = async () => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(reviewText)
      setMessage(text({ ja: 'コピーしました。', en: 'Copied.' }))
    } catch {
      setMessage(text({ ja: 'このデモではコピー操作を省略しています。', en: 'Copy is unavailable in this demo environment.' }))
    }
  }

  return (
    <div className="landing__survey-phone" aria-label={text({ ja: '操作できるクチトルZeroの固定アンケートデモ', en: 'Interactive Kuchitoru Zero five-question survey demo' })}>
      <div className="landing__survey-status"><span>9:41</span><span>●●● 5G ▰</span></div>
      <div className="landing__survey-live-shell">
        <header className="landing__survey-live-toolbar">
          <strong aria-label={locale === 'ja' ? 'クチトルZero' : 'Kuchitoru Zero'}><img src={kuchitoruLogo} alt="" aria-hidden="true" /></strong>
          <span>{mode === 'survey' ? text({ ja: '5問アンケート', en: 'Five-question survey' }) : text({ ja: '口コミ文を確認', en: 'Review your text' })}</span>
        </header>
        <div className="landing__survey-live-body">
          {mode === 'survey' ? (
            <form className="landing__survey-profile form-stack" onSubmit={(event) => { event.preventDefault(); submitSurvey() }}>
              <h1>{text({ ja: 'ご利用について教えてください', en: 'Tell us about your visit' })}</h1>
              <p>{text({ ja: '来店頻度、評価、利用内容、印象に残ったこと、改善してほしいことを伺います。回答をもとに、確認・編集できる口コミ文を作成します。', en: 'We ask about visit frequency, rating, use, highlights, and improvements, then shape editable review text.' })}</p>
              <fieldset>
                <legend>{text({ ja: '1. 来店頻度（任意）', en: '1. Visit frequency (optional)' })}</legend>
                <div className="choice-grid">
                  {(locale === 'ja' ? [['first', '初めて'], ['occasional', 'ときどき'], ['regular', 'よく利用する'], ['unknown', '回答しない']] as const : [['first', 'First visit'], ['occasional', 'Sometimes'], ['regular', 'Often'], ['unknown', 'Prefer not to answer']] as const).map(([value, label]) => (
                    <label key={value}>
                      <input type="radio" name="landing-visit-frequency" value={value} checked={visitFrequency === value} onChange={() => setVisitFrequency(value)} />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>{text({ ja: '2. 今回の評価（任意）', en: '2. Rating (optional)' })}</legend>
                <div className="rating-row">
                  {[1, 2, 3, 4, 5].map((value) => <button type="button" key={value} aria-pressed={rating === value} onClick={() => setRating(value)}>{value}</button>)}
                  <button type="button" aria-pressed={rating === 'skip'} onClick={() => setRating('skip')}>{text({ ja: '回答しない', en: 'Prefer not to answer' })}</button>
                </div>
              </fieldset>
              <label>{text({ ja: '3. 利用したサービスや商品', en: '3. Service or product used' })}<span className="required-mark">{text({ ja: '必須', en: 'Required' })}</span><textarea required rows={3} maxLength={120} value={serviceUsed} onChange={(event) => setServiceUsed(event.target.value)} placeholder={text({ ja: 'ご利用内容を教えてください', en: 'Tell us what you used' })} /></label>
              <label>{text({ ja: '4. 印象に残ったこと', en: '4. What stood out' })}<span className="required-mark">{text({ ja: '必須', en: 'Required' })}</span><textarea required rows={4} maxLength={300} value={memorablePoints} onChange={(event) => setMemorablePoints(event.target.value)} placeholder={text({ ja: '良かったことを教えてください', en: 'Tell us what went well' })} /></label>
              <label>{text({ ja: '5. 改善してほしいことや、ほかに伝えたいこと', en: '5. Improvements or anything else' })}<textarea rows={3} maxLength={300} value={improvementPoints} onChange={(event) => setImprovementPoints(event.target.value)} placeholder={text({ ja: '任意でご記入ください', en: 'Optional' })} /></label>
              <button className="button button--primary" type="submit" disabled={!serviceUsed.trim() || !memorablePoints.trim()}>{text({ ja: '回答を送信して口コミ文を作る', en: 'Submit answers and create review text' })}</button>
            </form>
          ) : (
            <section className="landing__survey-review">
              <p>{text({ ja: '回答をもとに整えました。内容を確認して、自由に編集してください。', en: 'Shaped from your answers. Review and edit it freely.' })}</p>
              <label htmlFor="landing-survey-review">{text({ ja: '口コミ文', en: 'Review text' })}</label>
              <textarea id="landing-survey-review" maxLength={800} value={reviewText} onChange={(event) => { setReviewText(event.target.value); setMessage('') }} />
              <p className="character-count">{reviewText.length} / {text({ ja: '800文字', en: '800 characters' })}</p>
              {message ? <p className="landing__survey-demo-message" role="status">{message}</p> : null}
              <button className="button button--secondary" type="button" onClick={() => setMessage(text({ ja: 'このデモでは生成文を固定表示しています。', en: 'This demo uses fixed generated text.' }))}><RefreshCw aria-hidden="true" />{text({ ja: 'もう一度整える ', en: 'Shape again ' })}<small>{text({ ja: '残り2回', en: '2 remaining' })}</small></button>
              <button className="button button--secondary" type="button" onClick={() => setMessage(text({ ja: '編集内容を保存しました。', en: 'Edits saved.' }))}><Check aria-hidden="true" />{text({ ja: '編集内容を保存', en: 'Save edits' })}</button>
              <button className="button button--secondary" type="button" onClick={() => void copyReview()}><Clipboard aria-hidden="true" />{text({ ja: '文章をコピー', en: 'Copy text' })}</button>
              <button className="button button--primary" type="button" onClick={() => setMessage(text({ ja: 'デモではGoogle口コミ画面へ遷移しません。', en: 'The demo does not open Google Reviews.' }))}><MapPinned aria-hidden="true" />{text({ ja: 'Google口コミ画面を開く', en: 'Open Google Reviews' })}</button>
              <button className="button button--quiet" type="button" onClick={reset}>{text({ ja: '投稿せずに終了', en: 'Finish without posting' })}</button>
              <p className="review-choice">{text({ ja: '投稿するかどうかはあなたが決められます。', en: 'You decide whether to post.' })}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

export function NotFoundPage() {
  const { text } = useI18n()
  return (
    <main className="not-found">
      <header className="not-found__toolbar"><BrandMark /></header>
      <section className="not-found__content">
        <p className="landing__eyebrow">404</p>
        <h1>{text({ ja: 'ページが見つかりません', en: 'Page not found' })}</h1>
        <p>{text({ ja: 'URLをご確認いただくか、ホームへ戻ってください。', en: 'Check the URL or return home.' })}</p>
        <Link className="button button--primary" to="/">{text({ ja: 'ホームへ戻る', en: 'Return home' })}</Link>
      </section>
    </main>
  )
}
