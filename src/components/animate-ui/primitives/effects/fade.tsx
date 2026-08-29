'use client';

import * as React from 'react';
import { motion, type HTMLMotionProps } from 'motion/react';

import {
  useIsInView,
  type UseIsInViewOptions,
} from '@/hooks/use-is-in-view';
import { Slot, type WithAsChild } from '@/components/animate-ui/primitives/animate/slot';

type FadeProps = WithAsChild<
  {
    children?: React.ReactNode;
    delay?: number;
    initialOpacity?: number;
    opacity?: number;
    ref?: React.Ref<HTMLElement>;
  } & UseIsInViewOptions &
    HTMLMotionProps<'div'>
>;

function Fade({
  ref,
  transition = { type: 'spring', stiffness: 200, damping: 20 },
  delay = 0,
  inView = false,
  inViewMargin = '0px',
  inViewOnce = true,
  initialOpacity = 0,
  opacity = 1,
  asChild = false,
  style: customStyle,
  ...props
}: FadeProps) {
  const { ref: localRef, isInView } = useIsInView(
    ref as React.Ref<HTMLElement>,
    {
      inView,
      inViewOnce,
      inViewMargin,
    },
  );

  const Component = asChild ? Slot : motion.div;
  const isTest = import.meta.env.MODE === 'test';
  const visible = isTest || isInView;
  const resolvedStyle = isTest
    ? { ...customStyle, opacity: 1 } as NonNullable<React.ComponentProps<typeof motion.div>['style']>
    : customStyle;
  const styleProps = resolvedStyle === undefined ? {} : { style: resolvedStyle };

  return (
    <Component
      ref={localRef as React.Ref<HTMLDivElement>}
      initial={isTest ? false : 'hidden'}
      animate={visible ? 'visible' : 'hidden'}
      exit="hidden"
      variants={{
        hidden: { opacity: initialOpacity },
        visible: { opacity },
      }}
      transition={isTest ? { duration: 0 } : {
        ...transition,
        delay: (transition?.delay ?? 0) + delay / 1000,
      }}
      {...props}
      {...styleProps}
    />
  );
}

type FadeListProps = Omit<FadeProps, 'children'> & {
  children: React.ReactElement | React.ReactElement[];
  holdDelay?: number;
};

function Fades({
  children,
  delay = 0,
  holdDelay = 0,
  ...props
}: FadeListProps) {
  const array = React.Children.toArray(children) as React.ReactElement[];

  return (
    <>
      {array.map((child, index) => (
        <Fade
          key={child.key ?? index}
          delay={delay + index * holdDelay}
          {...props}
        >
          {child}
        </Fade>
      ))}
    </>
  );
}

export { Fade, Fades, type FadeProps, type FadeListProps };
