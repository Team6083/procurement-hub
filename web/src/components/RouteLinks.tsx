import { Anchor, Button, type AnchorProps, type ButtonProps } from '@mantine/core';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

/**
 * Mantine anchor/button that navigate client-side. `to` is an app path ("/batches/1");
 * react-router prepends the basename to the rendered href and to the navigation.
 */
export function RouteAnchor({ to, children, ...rest }: AnchorProps & { to: string; children: ReactNode }) {
  return (
    <Anchor component={Link} to={to} {...rest}>
      {children}
    </Anchor>
  );
}

export function RouteButton({ to, children, ...rest }: ButtonProps & { to: string; children: ReactNode }) {
  return (
    <Button component={Link} to={to} {...rest}>
      {children}
    </Button>
  );
}
