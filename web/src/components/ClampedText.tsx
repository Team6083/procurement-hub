import { Text, type TextProps } from '@chakra-ui/react';
import { Tooltip } from '@team6083/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Text cut off with "…" after `lines` lines. Only when it really is cut off, hovering it (or focusing it,
 * which a tap does on a phone) shows the full text in a tooltip.
 */
export function ClampedText({ text, lines = 2, children, ...rest }: { text: string; lines?: number; children?: ReactNode } & Omit<TextProps, 'children'>) {
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
    <Tooltip content={text} openDelay={300} disabled={!clipped} contentProps={{ maxW: 'sm', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
      <Text as="span" ref={ref} lineClamp={lines} overflowWrap="anywhere" tabIndex={clipped ? 0 : undefined} {...rest}>{children ?? text}</Text>
    </Tooltip>
  );
}
