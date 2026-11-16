import { Badge } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import type { MatchState, ProblemAction } from '../../api/types';

const MATCH_COLOR: Record<MatchState, string> = { unmatched: 'orange', partial: 'yellow', matched: 'green', not_needed: 'gray' };

export function MatchStateBadge({ state }: { state: MatchState }) {
  const { t } = useTranslation('receiving');
  return <Badge variant="subtle" colorPalette={MATCH_COLOR[state]}>{t(`matchState.${state}`)}</Badge>;
}

export function VoidedBadge() {
  const { t } = useTranslation('receiving');
  return <Badge variant="subtle" colorPalette="red">{t('voided')}</Badge>;
}

/** An open problem, or how it was settled. */
export function ProblemBadge({ resolution }: { resolution: ProblemAction | null | undefined }) {
  const { t } = useTranslation('receiving');
  if (!resolution) return <Badge variant="subtle" colorPalette="red">{t('problem.open')}</Badge>;
  return <Badge variant="subtle" colorPalette="green">{t(`problem.actions.${resolution}`)}</Badge>;
}
