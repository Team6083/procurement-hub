import { Badge, type BadgeProps } from '@chakra-ui/react';
import { Tooltip } from '@team6083/ui';
import { useTranslation } from 'react-i18next';

// P5 and P4 stand out, the rest stay grey (the team's rule: grey by default, colour for emphasis).
const STYLE: Record<number, BadgeProps> = {
  5: { colorPalette: 'red', variant: 'solid' },
  4: { colorPalette: 'orange', variant: 'subtle' },
  3: { colorPalette: 'yellow', variant: 'subtle' },
  2: { colorPalette: 'gray', variant: 'subtle' },
  1: { colorPalette: 'gray', variant: 'outline' },
};

/** An item's priority as P1–P5; the team's label for it shows on hover or focus. */
export function PriorityBadge({ priority, label }: { priority: number; label: string }) {
  const { t } = useTranslation('batches');
  const text = t('item.priorityOf', { label });
  return (
    <Tooltip content={text}>
      <Badge size="sm" flexShrink={0} tabIndex={0} aria-label={text} {...STYLE[priority]}>P{priority}</Badge>
    </Tooltip>
  );
}
