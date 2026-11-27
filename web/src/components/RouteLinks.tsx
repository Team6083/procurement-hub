import { Button, Link as ChakraLink, type ButtonProps, type LinkProps } from '@chakra-ui/react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

/**
 * Chakra link/button that navigate client-side. `to` is an app path ("/batches/1");
 * react-router prepends the basename to the rendered href and to the navigation.
 */
export function RouteAnchor({ to, children, ...rest }: Omit<LinkProps, 'href' | 'asChild'> & { to: string; children: ReactNode }) {
  return (
    <ChakraLink {...rest} asChild>
      <Link to={to}>{children}</Link>
    </ChakraLink>
  );
}

export function RouteButton({ to, children, ...rest }: Omit<ButtonProps, 'asChild'> & { to: string; children: ReactNode }) {
  return (
    <Button {...rest} asChild>
      <Link to={to}>{children}</Link>
    </Button>
  );
}
