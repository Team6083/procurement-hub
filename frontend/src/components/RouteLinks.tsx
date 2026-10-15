import { Anchor, Button, type AnchorProps, type ButtonProps } from '@mantine/core';
import { useRouter } from '@tanstack/react-router';
import type { MouseEvent, ReactNode } from 'react';

function useGo(href: string) {
  const router = useRouter();
  return (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    router.history.push(href);
  };
}

/** Client-side navigation links for dynamic paths (Mantine polymorphic + typed router params do not mix). */
export function RouteAnchor({ href, children, ...rest }: AnchorProps & { href: string; children: ReactNode }) {
  return (
    <Anchor href={href} onClick={useGo(href)} {...rest}>
      {children}
    </Anchor>
  );
}

export function RouteButton({ href, children, ...rest }: ButtonProps & { href: string; children: ReactNode }) {
  return (
    <Button component="a" href={href} onClick={useGo(href)} {...rest}>
      {children}
    </Button>
  );
}
