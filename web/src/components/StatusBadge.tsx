import { Badge } from '@chakra-ui/react';
import type { ReactNode } from 'react';

/**
 * What a status means, the one place that turns it into a colour. Status colours mean
 * status only: green done, orange needs someone's attention, red refused or void, purple finished for good; gray
 * outline for what has not started or is out of the flow, gray subtle for work in progress, yellow for sent back to be changed; blue, cyan and teal tell a batch's collecting, purchasing and receiving apart.
 */
export type StatusTone = 'neutral' | 'active' | 'attention' | 'returned' | 'collecting' | 'purchasing' | 'receiving' | 'done' | 'finished' | 'bad';

const TONES: Record<StatusTone, { colorPalette: string; variant: 'subtle' | 'outline' }> = {
  neutral: { colorPalette: 'gray', variant: 'outline' },
  active: { colorPalette: 'gray', variant: 'subtle' },
  attention: { colorPalette: 'orange', variant: 'subtle' },
  returned: { colorPalette: 'yellow', variant: 'subtle' },
  collecting: { colorPalette: 'blue', variant: 'subtle' },
  purchasing: { colorPalette: 'cyan', variant: 'subtle' },
  receiving: { colorPalette: 'teal', variant: 'subtle' },
  done: { colorPalette: 'green', variant: 'subtle' },
  finished: { colorPalette: 'purple', variant: 'subtle' },
  bad: { colorPalette: 'red', variant: 'subtle' },
};

export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return <Badge {...TONES[tone]} whiteSpace="nowrap">{children}</Badge>;
}
