import { render, screen } from '@testing-library/react'
import { MemoryRouter, NavLink } from 'react-router'
import { describe, expect, test } from 'vitest'
import { AnimateIcon } from './icons/icon'
import { HouseWifi } from './icons/house-wifi'
import { Fade, Fades } from './primitives/effects/fade'
import { LiquidButton } from './primitives/buttons/liquid'
import { SlidingNumber } from './primitives/texts/sliding-number'

describe('Animate UI primitives', () => {
  test('Fade and Fades preserve their children in the document', () => {
    render(
      <>
        <Fade><span>単体表示</span></Fade>
        <Fades holdDelay={40}>
          <span>一つ目</span>
          <span>二つ目</span>
        </Fades>
      </>,
    )

    expect(screen.getByText('単体表示')).toBeInTheDocument()
    expect(screen.getByText('一つ目')).toBeInTheDocument()
    expect(screen.getByText('二つ目')).toBeInTheDocument()
  })

  test('SlidingNumber exposes the current numeric value', () => {
    render(<SlidingNumber number={42} initiallyStable />)

    expect(screen.getByText('42')).toBeInTheDocument()
  })

  test('LiquidButton remains a keyboard-operable button', () => {
    render(<LiquidButton>安全な操作</LiquidButton>)

    expect(screen.getByRole('button', { name: '安全な操作' })).toBeEnabled()
  })

  test('animated icon wrapper preserves NavLink state callbacks and semantics', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AnimateIcon asChild animateOnHover completeOnStop>
          <NavLink
            to="/dashboard"
            className={({ isActive }) => isActive ? 'is-active' : undefined}
            style={({ isActive }) => ({ opacity: isActive ? 1 : 0.5 })}
          >
            <HouseWifi aria-hidden="true" />
            ホーム
          </NavLink>
        </AnimateIcon>
      </MemoryRouter>,
    )

    const link = screen.getByRole('link', { name: 'ホーム' })
    expect(link).toHaveAttribute('href', '/dashboard')
    expect(link).toHaveClass('is-active')
    expect(link).toHaveStyle({ opacity: '1' })
  })
})
