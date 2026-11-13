import { Portal, Tooltip as ChakraTooltip } from '@chakra-ui/react';
import type { ReactNode } from 'react';

interface Props {
  content: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}

/** Tooltip around a single focusable or hoverable child. */
export function Tooltip({ content, disabled, children }: Props) {
  if (disabled || !content) return <>{children}</>;
  return (
    <ChakraTooltip.Root openDelay={300}>
      <ChakraTooltip.Trigger asChild>{children}</ChakraTooltip.Trigger>
      <Portal>
        <ChakraTooltip.Positioner>
          <ChakraTooltip.Content>{content}</ChakraTooltip.Content>
        </ChakraTooltip.Positioner>
      </Portal>
    </ChakraTooltip.Root>
  );
}
