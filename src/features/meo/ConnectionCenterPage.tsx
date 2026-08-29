import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, KeyRound, Link2, PlugZap, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ApiError } from '../../shared/api/http'
import { useI18n, type Locale } from '../../shared/i18n'
import { createIdempotencyKey } from '../../shared/lib/idempotency'
import { Button, LoadingState, Notice, PageTitle, Panel, Switch } from '../../shared/ui/ui'
import { ownerStorePath, useActiveStoreId } from '../owner/store-scope'
import { meoFeatureCapabilitiesQueryOptions } from './meo-api'
import type { MeoFeatureKey } from './feature-registry'
import {
  completeMeoOauthConnection,
  disconnectMeoProvider,
  getGoogleBusinessLocations,
  getMeoConnections,
  getMeoExternalWriteSettings,
  saveDataForSeoConnection,
  selectGoogleBusinessLocation,
  startMeoOauthConnection,
  updateMeoExternalWriteSettings,
  type MeoConnection,
  type MeoExternalProvider,
  type MeoOauthProvider,
} from './meo-service-api'
import {
  clearMeoOauthCallbackFragment,
  clearMeoOauthProof,
  createMeoOauthProof,
  findMeoOauthProofByState,
  loadMeoOauthProof,
  parseMeoOauthCallbackFragment,
  parseMeoOauthState,
  safeMeoAuthorizationRedirect,
  saveMeoOauthProof,
} from './meo-oauth-browser'

const PROVIDER_LABELS: Record<Locale, Record<MeoExternalProvider, string>> = {
  ja: { google_business: 'Googleビジネスプロフィール', instagram: 'Instagram', dataforseo: 'DataForSEO' },
  en: { google_business: 'Google Business Profile', instagram: 'Instagram', dataforseo: 'DataForSEO' },
}

function connectionStatus(connection: MeoConnection | undefined, locale: Locale = 'ja'): string {
  if (!connection) return locale === 'ja' ? '未接続' : 'Not connected'
  if (connection.status !== 'active') return locale === 'ja' ? '要再接続' : 'Reconnect required'
  if (connection.provider === 'google_business' && !connection.locationName) return locale === 'ja' ? '店舗を選択してください' : 'Select a location'
  return locale === 'ja' ? '接続済み' : 'Connected'
}

export function ConnectionCenterPage() {
  const { locale } = useI18n()
  const en = locale === 'en'
  const storeId = useActiveStoreId()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const callbackHandledRef = useRef(false)
  const [callbackFragment] = useState(() => parseMeoOauthCallbackFragment(window.location.hash))
  const [pending, setPending] = useState<string | null>(() => (
    callbackFragment || searchParams.get('connection') === 'oauth_callback'
      ? 'oauth:complete'
      : null
  ))
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const capabilitiesQuery = useQuery(meoFeatureCapabilitiesQueryOptions(storeId))
  const visibleKeys = useMemo<Set<MeoFeatureKey>>(() => new Set(
    (capabilitiesQuery.data?.features ?? [])
      .filter((feature) => feature.status !== 'hidden')
      .map((feature) => feature.key),
  ), [capabilitiesQuery.data])
  const googleFeatureKeys: MeoFeatureKey[] = [
    'review_reply',
    'gbp_insights',
    'gbp_health',
    'instagram_to_gbp',
  ]
  const showGoogle = googleFeatureKeys.some((key) => visibleKeys.has(key))
  const showInstagram = visibleKeys.has('instagram_to_gbp')
  const showDataForSeo = visibleKeys.has('meo_rank')
  const connectionsQuery = useQuery({
    queryKey: ['meo-connections', storeId],
    queryFn: () => getMeoConnections(storeId),
    retry: false,
  })
  const externalWritesQueryKey = ['meo-external-writes', storeId] as const
  const externalWritesQuery = useQuery({
    queryKey: externalWritesQueryKey,
    queryFn: () => getMeoExternalWriteSettings(storeId),
    retry: false,
  })
  const externalWritesMutation = useMutation({
    mutationFn: (enabled: boolean) => updateMeoExternalWriteSettings(
      storeId,
      enabled,
      createIdempotencyKey(),
    ),
    onMutate: () => {
      setMessage('')
      setError('')
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(externalWritesQueryKey, settings)
      setMessage(settings.enabled
        ? (en ? 'Writes to external services are enabled.' : '外部サービスへの書き込みを有効にしました。')
        : (en ? 'Writes to external services are disabled.' : '外部サービスへの書き込みを無効にしました。'))
    },
  })
  const byProvider = useMemo(
    () => new Map((connectionsQuery.data ?? []).map((connection) => [connection.provider, connection])),
    [connectionsQuery.data],
  )
  const googleConnection = byProvider.get('google_business')
  const instagramConnection = byProvider.get('instagram')
  const showExternal = showGoogle || showInstagram || showDataForSeo
  const locationsQuery = useQuery({
    queryKey: ['meo-google-locations', storeId],
    queryFn: () => getGoogleBusinessLocations(storeId),
    enabled: showGoogle && googleConnection?.status === 'active' && !googleConnection.locationName,
    retry: false,
  })

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['meo-connections', storeId] })
  }, [queryClient, storeId])

  useEffect(() => {
    const fragmentCallback = callbackFragment
    const queryCallback = searchParams.get('connection') === 'oauth_callback'
    if ((!fragmentCallback && !queryCallback) || callbackHandledRef.current) return
    callbackHandledRef.current = true

    const provider = fragmentCallback?.provider ?? null
    const state = fragmentCallback?.state ?? null
    const code = fragmentCallback?.code ?? null
    const matchingProof = state ? findMeoOauthProofByState(state) : null

    const failClosed = (detail: string) => {
      if (matchingProof) {
        clearMeoOauthProof(matchingProof.storeId, matchingProof.provider)
      } else {
        clearMeoOauthProof(storeId, 'google_business')
        clearMeoOauthProof(storeId, 'instagram')
      }
      setPending(null)
      setMessage('')
      setError(detail)
      setSearchParams({ connection: 'failed' }, { replace: true })
    }

    if (queryCallback) {
      if (fragmentCallback) clearMeoOauthCallbackFragment()
      const queryState = parseMeoOauthState(searchParams.get('state'))
      const queryProof = queryState ? findMeoOauthProofByState(queryState) : null
      if (queryProof) clearMeoOauthProof(queryProof.storeId, queryProof.provider)
      failClosed(en ? 'For your security, this connection URL was rejected. Start again with “Connect”.' : '安全のため、URLの形式が違う接続は受け付けませんでした。「接続する」からもう一度やり直してください。')
      return
    }
    if (!provider || !state || !code || !matchingProof) {
      clearMeoOauthCallbackFragment()
      failClosed(en ? 'The security check failed, so nothing was connected. Start again with “Connect”.' : '安全確認ができなかったため、接続していません。「接続する」からもう一度やり直してください。')
      return
    }
    if (matchingProof.storeId !== storeId || matchingProof.provider !== provider) {
      clearMeoOauthCallbackFragment()
      failClosed(en ? 'This connection belongs to another store or service. Start again from this store.' : '別の店舗またはサービス用の接続だったため、接続していません。この店舗の「接続する」からやり直してください。')
      return
    }
    const proof = loadMeoOauthProof(storeId, provider)
    if (!proof || proof.expectedState !== state) {
      clearMeoOauthCallbackFragment()
      failClosed(en ? 'The connection request expired. Start again with “Connect”.' : '接続の有効時間が切れたため、接続していません。「接続する」からもう一度やり直してください。')
      return
    }
    if (!clearMeoOauthCallbackFragment()) {
      failClosed(en ? 'The connection details could not be removed from the URL, so processing stopped. Close this page and try again.' : '安全のため、URLから接続情報を消せなかったので処理を止めました。ページを閉じてから、もう一度お試しください。')
      return
    }

    void completeMeoOauthConnection(
      storeId,
      provider,
      { state, code, verifier: proof.verifier },
      proof.idempotencyKey,
    ).then(async (result) => {
      setSearchParams({
        connection: result.selectLocation ? 'select_location' : 'connected',
        provider,
      }, { replace: true })
      setMessage(result.selectLocation
        ? (en ? 'Connected. Now select the Google location to use.' : '接続できました。続けて、利用するGoogle店舗を選んでください。')
        : (en ? `Connected to ${PROVIDER_LABELS[locale][provider]}.` : `${PROVIDER_LABELS[locale][provider]}へ接続しました。`))
      await refresh()
    }).catch(async (caught) => {
      if (caught instanceof ApiError && caught.code === 'PROVIDER_RESULT_SETTLEMENT_FAILED') {
        setSearchParams({ connection: 'attention_required' }, { replace: true })
        setError(en ? 'The Google connection may already be saved. Do not reconnect; report the displayed status to an administrator.' : 'Google接続は保存済みの可能性があります。再接続せず、表示された接続状態を管理者へお知らせください。')
        await refresh()
        return
      }
      setSearchParams({ connection: 'failed' }, { replace: true })
      setError(en ? 'The connection could not be completed and was not retried automatically. Check its status, then try again.' : '接続を完了できませんでした。自動では再送していません。接続状態を確認してから、もう一度お試しください。')
    }).finally(() => {
      clearMeoOauthProof(storeId, provider)
      setPending(null)
    })
  }, [callbackFragment, en, locale, refresh, searchParams, setSearchParams, storeId])

  const run = async (id: string, action: () => Promise<unknown>, success: string) => {
    if (pending) return
    setPending(id)
    setError('')
    setMessage('')
    try {
      await action()
      setMessage(success)
      await refresh()
    } catch (caught) {
      setError(en ? 'The action could not be completed. Check the connection status and try again.' : caught instanceof Error ? caught.message : '処理を完了できませんでした。')
    } finally {
      setPending(null)
    }
  }

  const startOauth = async (provider: MeoOauthProvider) => {
    if (pending) return
    setPending(`${provider}:start`)
    setError('')
    setMessage('')
    try {
      const proof = await createMeoOauthProof()
      const { authorizationUrl } = await startMeoOauthConnection(storeId, provider, { challenge: proof.challenge })
      const redirect = safeMeoAuthorizationRedirect(provider, authorizationUrl, locale)
      saveMeoOauthProof({
        storeId,
        provider,
        verifier: proof.verifier,
        expectedState: redirect.state,
        idempotencyKey: proof.idempotencyKey,
        createdAt: proof.createdAt,
      })
      window.location.assign(redirect.url)
    } catch (caught) {
      clearMeoOauthProof(storeId, provider)
      setError(en ? 'The connection could not be started. Try again.' : caught instanceof Error ? caught.message : '接続を開始できませんでした。')
      setPending(null)
    }
  }

  const disconnect = (provider: MeoExternalProvider) => {
    const label = PROVIDER_LABELS[locale][provider]
    if (!window.confirm(en ? `Disconnect ${label}? Saved credentials will be deleted.` : `${label}との接続を解除しますか？保存した認証情報は削除されます。`)) return
    void run(`${provider}:delete`, () => disconnectMeoProvider(storeId, provider), en ? `Disconnected from ${label}.` : `${label}との接続を解除しました。`)
  }

  const saveDataForSeo = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const login = String(data.get('login') ?? '').trim()
    const password = String(data.get('password') ?? '')
    void run('dataforseo:save', async () => {
      await saveDataForSeoConnection(storeId, { login, password })
      form.reset()
    }, en ? 'Connected to DataForSEO.' : 'DataForSEOへ接続しました。')
  }

  const callbackStatus = searchParams.get('connection')
  const callbackMessage = callbackStatus === 'connected'
    ? (en ? 'Connected to the external service.' : '外部サービスへ接続しました。')
    : callbackStatus === 'select_location'
      ? (en ? 'Google is connected. Select the location to use.' : 'Googleの接続が完了しました。利用する店舗を選んでください。')
      : callbackStatus === 'cancelled'
        ? (en ? 'Connection cancelled. No settings were changed.' : '接続をキャンセルしました。設定は変わっていません。')
        : callbackStatus === 'failed'
          ? (en ? 'The connection could not be completed. Try again.' : '接続を完了できませんでした。もう一度お試しください。')
          : null

  const providerPanel = (
    provider: MeoOauthProvider,
    description: string,
    canManageConnection = true,
  ) => {
    const connection = byProvider.get(provider)
    const label = PROVIDER_LABELS[locale][provider]
    return (
      <Panel className="meo-connection-card" key={provider}>
        <div className="meo-connection-card__header">
          <div><h2>{label}</h2><p>{description}</p></div>
          <span className={connection?.status === 'active' ? 'connection-status connection-status--active' : 'connection-status'}>
            {connectionStatus(connection, locale)}
          </span>
        </div>
        {connection?.displayName ? <p className="field-help">{en ? 'Connected account: ' : '接続先：'}{connection.displayName}</p> : null}
        {provider === 'google_business' && connection?.status === 'active' && !connection.locationName ? (
          <div className="form-stack">
            {locationsQuery.isLoading ? <LoadingState label={en ? 'Checking Google locations' : 'Googleの店舗を確認しています'} /> : null}
            {locationsQuery.isError ? <Notice tone="error">{en ? 'Google locations could not be loaded. Reconnect and try again.' : 'Googleの店舗一覧を取得できませんでした。再接続してお試しください。'}</Notice> : null}
            {(locationsQuery.data ?? []).map((location) => (
              <Button
                key={location.name}
                type="button"
                variant="secondary"
                busy={pending === `location:${location.name}`}
                disabled={pending !== null}
                onClick={() => void run(
                  `location:${location.name}`,
                  () => selectGoogleBusinessLocation(storeId, location.name),
                  en ? `${location.title} is now the selected location.` : `${location.title}を利用する店舗に設定しました。`,
                )}
              >
                {location.title}{location.storefrontAddress ? (en ? ` (${location.storefrontAddress})` : `（${location.storefrontAddress}）`) : ''}
              </Button>
            ))}
          </div>
        ) : null}
        {canManageConnection ? (
          <div className="meo-connection-card__actions">
            <Button
              type="button"
              variant={connection ? 'secondary' : 'primary'}
              busy={pending === `${provider}:start`}
              disabled={pending !== null}
              onClick={() => void startOauth(provider)}
            >
              <Link2 aria-hidden="true" />{connection ? (en ? 'Reconnect' : '再接続する') : (en ? 'Connect' : '接続する')}
            </Button>
            {connection ? (
              <Button type="button" variant="quiet" disabled={pending !== null} onClick={() => disconnect(provider)}>
                <Trash2 aria-hidden="true" />{en ? 'Disconnect' : '解除'}
              </Button>
            ) : null}
          </div>
        ) : null}
      </Panel>
    )
  }

  return (
    <div className="owner-page meo-connections-page">
      <PageTitle
        title={en ? 'External service connections' : '外部サービス接続'}
        showTitle
      />
      {callbackMessage && !message && !error
        ? <Notice tone={callbackStatus === 'failed' ? 'error' : 'info'}>{callbackMessage}</Notice>
        : null}
      {callbackStatus === 'oauth_callback' ? <LoadingState label={en ? 'Securely verifying connection details' : '安全に接続内容を確認しています'} /> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {capabilitiesQuery.isLoading ? <LoadingState label={en ? 'Checking available connections' : '利用できる接続を確認しています'} /> : null}
      {capabilitiesQuery.isError ? (
        <Notice tone="error">{en ? 'New external connections are hidden because availability could not be checked. Reload in a moment.' : '公開状態を確認できないため、新しい外部接続を表示していません。しばらくしてから再読み込みしてください。'}</Notice>
      ) : null}
      {connectionsQuery.isLoading ? <LoadingState label={en ? 'Checking connection status' : '接続状態を確認しています'} /> : null}
      {connectionsQuery.isError ? (
        <Notice tone="error">{en ? 'Connection status could not be loaded. This does not mean disconnected, so changes are disabled here.' : '接続状態を取得できませんでした。未接続という意味ではないため、この画面では変更できません。'}</Notice>
      ) : null}
      <Panel className="meo-connection-card">
        <div className="meo-connection-card__header">
          <div>
            <h2>{en ? 'Writes to external services' : '外部サービスへの書き込み'}</h2>
            <p>
              {en
                ? 'Replies and posts to Google are disabled by default. Each send still requires confirmation after this setting is enabled.'
                : 'Googleへの返信や投稿は初期状態で無効です。有効にした後も、送信するたびに確認が必要です。'}
            </p>
          </div>
          <Switch
            checked={externalWritesQuery.data?.enabled === true}
            label={en ? 'Allow replies and posts to Google' : 'Googleへの返信と投稿を許可'}
            disabled={
              !externalWritesQuery.isSuccess
              || externalWritesQuery.data.canManage !== true
              || externalWritesMutation.isPending
            }
            aria-busy={externalWritesMutation.isPending}
            onClick={() => externalWritesMutation.mutate(!externalWritesQuery.data?.enabled)}
          />
        </div>
        {externalWritesQuery.isLoading ? (
          <LoadingState label={en ? 'Checking the external write setting' : '外部書き込みの設定を確認しています'} />
        ) : null}
        {externalWritesQuery.isError ? (
          <Notice tone="warning">
            {en
              ? 'The external write setting could not be loaded, so changes are disabled.'
              : '外部書き込みの設定を取得できないため、変更できません。'}
          </Notice>
        ) : null}
        {externalWritesQuery.isSuccess && !externalWritesQuery.data.canManage ? (
          <Notice tone="info">
            {en
              ? 'Only store owners and administrators can change this setting.'
              : 'この設定を変更できるのは、店舗のオーナーまたは管理者です。'}
          </Notice>
        ) : null}
        {externalWritesMutation.isError ? (
          <Notice tone="error">
            {en
              ? 'The setting could not be updated. Reload the page to check its current value.'
              : '設定を変更できませんでした。再読み込みして、現在の設定を確認してください。'}
          </Notice>
        ) : null}
      </Panel>
      {connectionsQuery.isSuccess ? (
        <div className="meo-connection-grid">
          {showGoogle ? providerPanel('google_business', en ? 'Review replies, analytics, and posts' : '口コミ返信、分析、投稿') : null}
          {showInstagram || instagramConnection
            ? providerPanel(
                'instagram',
                en ? 'Import posts; publishing always requires confirmation' : '投稿を読み込みます。Googleへの公開には毎回確認が必要です',
                showInstagram,
              )
            : null}
          {showDataForSeo ? (
            <Panel className="meo-connection-card">
              <div className="meo-connection-card__header">
                <div><h2>DataForSEO</h2><p>{en ? 'Automatic rank tracking' : '順位の自動計測'}</p></div>
                <span className={byProvider.get('dataforseo')?.status === 'active' ? 'connection-status connection-status--active' : 'connection-status'}>
                  {connectionStatus(byProvider.get('dataforseo'), locale)}
                </span>
              </div>
              <form className="form-stack" onSubmit={saveDataForSeo}>
                <label>{en ? 'Login ID' : 'ログインID'}<input name="login" required type="email" autoComplete="username" /></label>
                <label>{en ? 'Password' : 'パスワード'}<input name="password" required type="password" minLength={8} autoComplete="new-password" /></label>
                <p className="field-help">{en ? 'Credentials are encrypted at rest and are never shown again.' : '認証情報は暗号化して保存し、画面には再表示しません。'}</p>
                <Button type="submit" busy={pending === 'dataforseo:save'} disabled={pending !== null}>
                  <KeyRound aria-hidden="true" />{en ? 'Verify and save' : '確認して保存'}
                </Button>
              </form>
              {byProvider.has('dataforseo') ? (
                <Button type="button" variant="quiet" disabled={pending !== null} onClick={() => disconnect('dataforseo')}>
                  <Trash2 aria-hidden="true" />{en ? 'Disconnect' : '接続を解除'}
                </Button>
              ) : null}
            </Panel>
          ) : null}
        </div>
      ) : null}
      {!showExternal && !instagramConnection && !capabilitiesQuery.isLoading && !capabilitiesQuery.isError ? (
        <Notice tone="info">{en ? 'Required connections will appear here as new Google growth features become available.' : 'Google集客の新機能が公開されると、必要な接続だけここに表示されます。'}</Notice>
      ) : null}
      <Panel className="meo-connection-card">
        <div className="meo-connection-card__header">
          <div><h2>{en ? 'AI connection' : 'AI接続'}</h2><p>{en ? 'Generate review text' : '口コミ文の生成'}</p></div>
          <PlugZap aria-hidden="true" />
        </div>
        <Link className="button button--secondary" to={ownerStorePath(storeId, '/ai')}>
          {en ? 'Open AI connection' : 'AI接続を開く'} <ExternalLink aria-hidden="true" />
        </Link>
      </Panel>
    </div>
  )
}
