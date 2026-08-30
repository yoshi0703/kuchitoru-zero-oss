import type { ReactNode } from 'react'
import { useI18n } from '../../shared/i18n'
import {
  MeoWorkspaceErrorState,
  MeoWorkspaceLoadingState,
  MeoWorkspacePage,
  MeoWorkspacePermissionNotice,
} from './components'
import { MeoWorkspaceNavigation } from './MeoWorkspaceNavigation'
import { useMeoWorkspace } from './useMeoWorkspace'

type Props = {
  title: string
  description: ReactNode
  actions?: ReactNode
  children: (context: ReturnType<typeof useMeoWorkspace> & {
    role: NonNullable<ReturnType<typeof useMeoWorkspace>['authorization']>['role']
  }) => ReactNode
}

export function MeoWorkspacePageFrame({ title, description, actions, children }: Props) {
  const workspace = useMeoWorkspace()
  const { text } = useI18n()
  if (workspace.query.isLoading) {
    return <MeoWorkspaceLoadingState title={text({ ja: 'MEO管理データを読み込んでいます', en: 'Loading MEO workspace data' })} />
  }
  if (workspace.query.isError || !workspace.authorization) {
    return (
      <MeoWorkspaceErrorState
        title={text({ ja: 'MEO管理データを読み込めませんでした', en: 'Could not load MEO workspace data' })}
        description={text({ ja: '通信状態と店舗へのアクセス権を確認して、もう一度お試しください。', en: 'Check your connection and access to this store, then try again.' })}
        onRetry={() => void workspace.query.refetch()}
      />
    )
  }

  const role = workspace.authorization.role
  return (
    <MeoWorkspacePage title={title} description={description} actions={actions}>
      <MeoWorkspaceNavigation />
      {workspace.authorization.approvalRequired ? (
        <MeoWorkspacePermissionNotice
          role={role}
          showWhenEditable
          title={text({ ja: '変更は承認制です', en: 'Changes require approval' })}
          description={text({ ja: 'Editorの変更は申請として保存され、OwnerまたはAdminの承認後に反映されます。', en: 'Editor changes are saved as requests and applied after approval by an Owner or Admin.' })}
        />
      ) : (
        <MeoWorkspacePermissionNotice role={role} />
      )}
      {children({ ...workspace, role })}
    </MeoWorkspacePage>
  )
}
