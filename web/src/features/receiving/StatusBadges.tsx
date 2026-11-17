import { useTranslation } from 'react-i18next';
import type { MatchState, ProblemAction } from '../../api/types';
import { StatusBadge, type StatusTone } from '../../components/StatusBadge';

const MATCH_TONE: Record<MatchState, StatusTone> = { unmatched: 'attention', partial: 'attention', matched: 'done', not_needed: 'neutral' };

export function MatchStateBadge({ state }: { state: MatchState }) {
  const { t } = useTranslation('receiving');
  return <StatusBadge tone={MATCH_TONE[state]}>{t(`matchState.${state}`)}</StatusBadge>;
}

export function VoidedBadge() {
  const { t } = useTranslation('receiving');
  return <StatusBadge tone="bad">{t('voided')}</StatusBadge>;
}

/** An open problem, or how it was settled. */
export function ProblemBadge({ resolution }: { resolution: ProblemAction | null | undefined }) {
  const { t } = useTranslation('receiving');
  if (!resolution) return <StatusBadge tone="bad">{t('problem.open')}</StatusBadge>;
  return <StatusBadge tone="done">{t(`problem.actions.${resolution}`)}</StatusBadge>;
}
