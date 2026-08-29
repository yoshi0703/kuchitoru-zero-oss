import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, Check, CheckCircle2, Clipboard, MapPinned, UserRound } from 'lucide-react'
import type { RefObject } from 'react'
import { cx } from '../../shared/lib/cx'
import { Button } from '../../shared/ui/ui'
import type { Locale } from '../../shared/i18n'

/**
 * Wording, order and the animation choreography share this single source so the
 * static list and the decorative phone mock can never drift apart.
 */
const HANDOFF_STEPS = { ja: [
  {
    id: 'signin',
    title: 'Googleにログイン',
    description: '未ログインならGoogleアカウントでログインします。',
  },
  {
    id: 'paste',
    title: '口コミ欄に貼り付け',
    description: 'コピーした口コミ文をGoogleの入力欄に貼り付けます。',
  },
  {
    id: 'post',
    title: '内容を確認して投稿',
    description: '文章と評価を確かめてから、投稿するか決められます。',
  },
] as const, en: [
  { id: 'signin', title: 'Sign in to Google', description: 'Sign in with your Google account if needed.' },
  { id: 'paste', title: 'Paste into the review field', description: 'Paste the review text into Google’s field.' },
  { id: 'post', title: 'Review and post', description: 'Check the text and rating, then decide whether to post.' },
] as const }

export type GoogleReviewHandoffStatus = 'idle' | 'copying' | 'handoff'

type GoogleReviewHandoffDialogProps = {
  open: boolean
  status: GoogleReviewHandoffStatus
  message: string
  error: string
  /** Radix only restores focus on its own `Dialog.Trigger`, so the opening button is handed over here. */
  triggerRef: RefObject<HTMLButtonElement | null>
  onOpenChange: (open: boolean) => void
  onCopy: () => void
  onConfirm: () => void
  locale?: Locale
}

/** The abstract phone mock is decoration only — every step is also written out in the list below it. */
function HandoffPreview({ locale }: { locale: Locale }) {
  const steps = HANDOFF_STEPS[locale]
  return (
    <div className="handoff-preview" aria-hidden="true">
      <div className="handoff-preview__device">
        <div className="handoff-preview__screen">
          <span className="handoff-preview__notch" />
          <div className="handoff-preview__step handoff-preview__step--signin">
            <span className="handoff-preview__avatar"><UserRound /></span>
            <span>{steps[0].title}</span>
          </div>
          <div className="handoff-preview__step handoff-preview__step--paste">
            <span className="handoff-preview__field-label">{locale === 'ja' ? '口コミを書く' : 'Write a review'}</span>
            <span className="handoff-preview__lines">
              <span /><span /><span />
            </span>
            <span className="handoff-preview__chip">{locale === 'ja' ? '貼り付け' : 'Paste'}</span>
            <span className="handoff-preview__cursor" />
          </div>
          <div className="handoff-preview__step handoff-preview__step--post">
            <span className="handoff-preview__avatar handoff-preview__avatar--done"><Check /></span>
            <span>{steps[2].title}</span>
          </div>
        </div>
      </div>
      <div className="handoff-preview__dots">
        {steps.map((step) => <span key={step.id} />)}
      </div>
    </div>
  )
}

export function GoogleReviewHandoffDialog({
  open,
  status,
  message,
  error,
  triggerRef,
  onOpenChange,
  onCopy,
  onConfirm,
  locale = 'ja',
}: GoogleReviewHandoffDialogProps) {
  const steps = HANDOFF_STEPS[locale]
  const busy = status === 'handoff'
  const keepOpenWhileBusy = (event: Event | KeyboardEvent) => {
    if (busy) event.preventDefault()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!busy || next) onOpenChange(next) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="handoff-dialog__overlay" />
        <Dialog.Content
          className="handoff-dialog__content"
          data-testid="google-handoff-dialog"
          aria-describedby="google-handoff-dialog-description"
          onEscapeKeyDown={keepOpenWhileBusy}
          onInteractOutside={keepOpenWhileBusy}
          onCloseAutoFocus={(event) => { event.preventDefault(); triggerRef.current?.focus() }}
        >
          <span className="handoff-dialog__icon" aria-hidden="true"><MapPinned /></span>
          <Dialog.Title className="handoff-dialog__title">{locale === 'ja' ? 'Googleへの投稿はあと少しです' : 'You’re almost ready to post on Google'}</Dialog.Title>
          <Dialog.Description className="handoff-dialog__description" id="google-handoff-dialog-description">
            {locale === 'ja' ? 'クチトルZeroから自動では投稿されません。次の画面でご自身で貼り付けてください。' : 'Kuchitoru Zero never posts automatically. Paste the text yourself on the next screen.'}
          </Dialog.Description>

          <HandoffPreview locale={locale} />

          <ol className="handoff-dialog__steps">
            {steps.map((step, index) => (
              <li key={step.id}>
                <span className="handoff-dialog__step-number" aria-hidden="true">{index + 1}</span>
                <span>
                  <strong>{step.title}</strong>
                  <span>{step.description}</span>
                </span>
              </li>
            ))}
          </ol>

          <p
            className={cx(
              'handoff-dialog__status',
              error && 'handoff-dialog__status--error',
              !error && message && 'handoff-dialog__status--success',
            )}
            data-testid="google-handoff-status"
            role="status"
            aria-live="polite"
          >
            {error
              ? <><AlertTriangle aria-hidden="true" />{error}</>
              : message
                ? <><CheckCircle2 aria-hidden="true" />{message}</>
                : null}
          </p>

          <div className="handoff-dialog__actions">
            <Button
              type="button"
              variant="secondary"
              data-testid="google-handoff-copy"
              busy={status === 'copying'}
              disabled={busy}
              onClick={onCopy}
            >
              <Clipboard aria-hidden="true" />{locale === 'ja' ? '口コミ文をコピー' : 'Copy review text'}
            </Button>
            <Button
              type="button"
              data-testid="google-handoff-confirm"
              busy={busy}
              disabled={status === 'copying'}
              onClick={onConfirm}
            >
              <MapPinned aria-hidden="true" />{locale === 'ja' ? '理解した、Googleマップへ' : 'Continue to Google Maps'}
            </Button>
            <p className="handoff-dialog__note">{locale === 'ja' ? '別の画面（Googleマップ）が開きます。' : 'Google Maps will open in a new screen.'}</p>
            <Dialog.Close asChild>
              <Button type="button" variant="quiet" data-testid="google-handoff-cancel" disabled={busy}>
                {locale === 'ja' ? '今はやめる' : 'Not now'}
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
