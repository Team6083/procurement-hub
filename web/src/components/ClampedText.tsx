import { Portal, Text, Tooltip as ChakraTooltip, type TextProps } from '@chakra-ui/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Text cut off with "…" after `lines` lines. Only when it really is cut off, hovering it (or focusing it,
 * which a tap does on a phone) shows the full text in a tooltip.
 */
export function ClampedText({ text, lines = 2, extra, children, ...rest }: { text: string; lines?: number; /** More text that only the tooltip shows; the tooltip is then always available. */ extra?: string; children?: ReactNode } & Omit<TextProps, 'children'>) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, lines]);
  return (
    <ChakraTooltip.Root openDelay={300} disabled={!clipped && !extra}>
      <ChakraTooltip.Trigger asChild>
        <Text as="span" ref={ref} lineClamp={lines} overflowWrap="anywhere" tabIndex={clipped || extra ? 0 : undefined} {...rest}>{children ?? text}</Text>
      </ChakraTooltip.Trigger>
      <Portal>
        <ChakraTooltip.Positioner>
          <ChakraTooltip.Content maxW="sm" whiteSpace="pre-wrap" overflowWrap="anywhere">{extra ? `${text}\n\n${extra}` : text}</ChakraTooltip.Content>
        </ChakraTooltip.Positioner>
      </Portal>
    </ChakraTooltip.Root>
  );
}
