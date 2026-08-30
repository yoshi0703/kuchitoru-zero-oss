import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Button, Notice, PageTitle, Panel } from '../../shared/ui/ui'
import { useI18n } from '../../shared/i18n'
import { acceptMeoWorkspaceInvitation } from './meo-workspace-api'
import { ownerStorePath } from '../owner/store-scope'

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function InvitationAcceptancePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const { text } = useI18n()
  const [token, setToken] = useState(() => {
    const sharedToken = params.get('token')?.trim() ?? ''
    return TOKEN_PATTERN.test(sharedToken) ? sharedToken : ''
  })
  const acceptance = useMutation({
    mutationFn: acceptMeoWorkspaceInvitation,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['owner-stores'] })
      navigate(ownerStorePath(result.storeId, '/meo/workspace/profile'), { replace: true })
    },
  })

  return (
    <main className="owner-page">
      <PageTitle title={text({ ja: 'MEO管理の招待を受ける', en: 'Accept an MEO workspace invitation' })} showTitle />
      <Panel>
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault()
            if (TOKEN_PATTERN.test(token)) acceptance.mutate(token)
          }}
        >
          <p>{text({ ja: '招待を作成した管理者から、安全な経路で受け取ったトークンを入力してください。ログイン中のメールアドレスと招待先が一致した場合だけ参加できます。', en: 'Enter the token you received securely from the administrator who created the invitation. You can join only when the invitation matches your signed-in email address.' })}</p>
          <label>
            {text({ ja: '招待トークン', en: 'Invitation token' })}
            <input
              value={token}
              autoComplete="off"
              spellCheck={false}
              required
              pattern="[A-Za-z0-9_-]{43}"
              onChange={(event) => setToken(event.target.value.trim())}
            />
          </label>
          {acceptance.isError ? <Notice tone="error">{text({ ja: '招待が無効、期限切れ、使用済み、またはログイン中のメールアドレスと一致しません。', en: 'This invitation is invalid, expired, already used, or does not match your signed-in email address.' })}</Notice> : null}
          <Button type="submit" busy={acceptance.isPending} disabled={!TOKEN_PATTERN.test(token)}>{text({ ja: '招待を受諾', en: 'Accept invitation' })}</Button>
        </form>
      </Panel>
    </main>
  )
}
