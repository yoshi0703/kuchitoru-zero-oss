import { NavLink, useLocation } from 'react-router'
import { cx } from '../../shared/lib/cx'
import { useI18n } from '../../shared/i18n'
import { useActiveStoreId } from '../owner/store-scope'
import { MEO_WORKSPACE_SECTIONS, meoWorkspacePath } from './meo-workspace-navigation'

export function MeoWorkspaceNavigation() {
  const storeId = useActiveStoreId()
  const location = useLocation()
  const { locale, text } = useI18n()

  return (
    <nav
      className="meo-workspace-tabs meo-workspace-primary-nav"
      aria-label={text({ ja: 'MEO管理', en: 'MEO workspace' })}
      data-meo-workspace-align="start"
    >
      {MEO_WORKSPACE_SECTIONS.map((section) => {
        const Icon = section.icon
        const to = meoWorkspacePath(storeId, section.id)
        const selected = location.pathname === to
        return (
          <NavLink
            key={section.id}
            to={to}
            role="tab"
            aria-selected={selected}
            className={cx('meo-workspace-tabs__tab', selected && 'meo-workspace-tabs__tab--selected')}
          >
            <Icon aria-hidden="true" />
            <span>{section.label[locale]}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}
