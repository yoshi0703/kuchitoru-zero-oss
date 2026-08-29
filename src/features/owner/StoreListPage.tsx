import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Store } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { createIdempotencyKey } from '../../shared/lib/idempotency'
import { useI18n } from '../../shared/i18n'
import { Button, EmptyState, LoadingState, Notice, PageTitle, Panel } from '../../shared/ui/ui'
import { createOwnerStore, getOwnerStores } from './owner-api'
import { ownerStorePath } from './store-scope'

export function StoreListPage() {
  const { locale, text } = useI18n()
  const copy = {
    loading: text({ ja: '店舗一覧を読み込んでいます', en: 'Loading stores' }), error: text({ ja: '店舗一覧を読み込めませんでした。', en: 'We couldn’t load your stores.' }),
    title: text({ ja: '店舗を選択', en: 'Select a store' }), add: text({ ja: '店舗を追加', en: 'Add store' }), name: text({ ja: '店舗名', en: 'Store name' }), submit: text({ ja: '追加する', en: 'Add' }),
    createError: text({ ja: '店舗を追加できませんでした。', en: 'We couldn’t add the store.' }),
    empty: text({ ja: '最初の店舗を追加してください', en: 'Add your first store' }), manage: text({ ja: 'この店舗を管理', en: 'Manage this store' }), sharedNotice: text({ ja: '共有された店舗を管理できます。新しい自店舗を作成する場合は「店舗を追加」を使用してください。', en: 'You can manage stores shared with you. Use “Add store” to create a store of your own.' }),
    paused: text({ ja: '停止中', en: 'Paused' }), draft: text({ ja: '下書き', en: 'Draft' }), published: text({ ja: '公開中', en: 'Published' }), member: text({ ja: 'メンバー', en: 'Member' }), shared: text({ ja: '共有店舗', en: 'Shared store' }),
  }
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [createKey, setCreateKey] = useState(createIdempotencyKey)
  const storesQuery = useQuery({
    queryKey: ['owner-stores'],
    queryFn: getOwnerStores,
  })
  const createMutation = useMutation({
    mutationFn: (storeName: string) => createOwnerStore({ name: storeName }, createKey),
    onSuccess: async (store) => {
      setCreateKey(createIdempotencyKey())
      await queryClient.invalidateQueries({ queryKey: ['owner-stores'] })
      navigate(ownerStorePath(store.id))
    },
  })

  if (storesQuery.isLoading) return <LoadingState label={copy.loading} />
  if (storesQuery.isError) {
    return <Notice tone="error">{copy.error}</Notice>
  }

  const stores = storesQuery.data ?? []
  const sharedStores = stores.filter((store) => store.is_owned === false)
  const ownedStores = stores.filter((store) => store.is_owned !== false)
  return (
    <main className="owner-page owner-store-list-page">
      <PageTitle
        title={copy.title}
        showTitle
        action={
          <div className="button-group">
            <Button
              type="button"
              onClick={() => setShowCreate((current) => !current)}
            >
              <Plus aria-hidden="true" />{copy.add}
            </Button>
          </div>
        }
      />
      {createMutation.isError ? (
        <Notice tone="error">
          {locale === 'ja' && createMutation.error instanceof Error
            ? createMutation.error.message
            : copy.createError}
        </Notice>
      ) : null}
      {showCreate ? (
        <Panel>
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault()
              const storeName = name.trim()
              if (storeName) createMutation.mutate(storeName)
            }}
          >
            <label>
              {copy.name}
              <input
                value={name}
                maxLength={120}
                required
                autoFocus
                onChange={(event) => {
                  setName(event.target.value)
                  setCreateKey(createIdempotencyKey())
                }}
              />
            </label>
            <Button type="submit" busy={createMutation.isPending} disabled={name.trim() === ''}>
              {copy.submit}
            </Button>
          </form>
        </Panel>
      ) : null}
      {stores.length === 0 ? (
        <EmptyState
          title={copy.empty}
          action={<Button onClick={() => setShowCreate(true)}>{copy.add}</Button>}
        />
      ) : (
        <div className="owner-card-grid">
          {stores.map((store) => {
            const statusLabel = store.status === 'published'
              ? copy.published
              : store.status === 'paused'
                ? copy.paused
                : copy.draft

            return (
              <Panel key={store.id}>
                <Store aria-hidden="true" />
                <h2>{store.name}</h2>
                <p>{store.is_owned === false ? (locale === 'ja'
                  ? `${copy.shared}（${store.access_role ?? copy.member}）・${statusLabel}`
                  : `${copy.shared} (${store.access_role ?? copy.member}) · ${statusLabel}`) : statusLabel}</p>
                <Link className="button button--secondary" to={ownerStorePath(store.id)}>
                  {copy.manage}
                </Link>
              </Panel>
            )
          })}
        </div>
      )}
      {sharedStores.length > 0 && ownedStores.length === 0 ? <Notice>{copy.sharedNotice}</Notice> : null}
    </main>
  )
}
