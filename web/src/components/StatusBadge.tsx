import { Badge } from '@chakra-ui/react';
import type { ReactNode } from 'react';

/**
 * What a status means, the one place that turns it into a colour (the team's DESIGN.md: Color). Status colours mean
 * status only: green done, orange needs someone's attention, red refused or void, purple finished for good; gray
 * outline for what has not started or is out of the flow, gray subtle for work in progress.
 */
export type StatusTone = 'neutral' | 'active' | 'attention' | 'done' | 'finished' | 'bad';

const TONES: Record<StatusTone, { colorPalette: string; variant: 'subtle' | 'outline' }> = {
  neutral: { colorPalette: 'gray', variant: 'outline' },
  active: { colorPalette: 'gray', variant: 'subtle' },
  attention: { colorPalette: 'orange', variant: 'subtle' },
  done: { colorPalette: 'green', variant: 'subtle' },
  finished: { colorPalette: 'purple', variant: 'subtle' },
  bad: { colorPalette: 'red', variant: 'subtle' },
};

export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return <Badge {...TONES[tone]}>{children}</Badge>;
}
