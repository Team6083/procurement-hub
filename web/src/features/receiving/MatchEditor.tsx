import { Alert, Button, HStack, Input, Separator, Skeleton, Stack, Text, Textarea } from '@chakra-ui/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSetMatches, useSuggestions } from '../../api/deliveries';
import type { Candidate, DeliveryLine, MatchRequest } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { AppDialog } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { BlockerList } from '../../components/UndoDialog';
import { parseCount } from './allocate';
import { CandidateLabel } from './CandidateLabel';

interface Row {
  vendorOrderLineId: string;
  candidate?: Candidate;
  vendorOrderNumber: number;
  lineNo: number;
  name: string;
  /** Units this row can hold: what the line still lacks plus what this delivery line already gave it. */
  max: number;
}

/** Existing matches and the server's candidates as one list; the start values are the current matches plus the suggested split. */
export function buildRows(line: DeliveryLine, candidates: Candidate[]): { rows: Row[]; start: Record<string, { good: string; problem: string }> } {
  const rows: Row[] = [];
  const start: Record<string, { good: string; problem: string }> = {};
  for (const m of line.matches) {
    const c = candidates.find((x) => x.vendorOrderLineId === m.vendorOrderLineId);
    rows.push({ vendorOrderLineId: m.vendorOrderLineId, candidate: c, vendorOrderNumber: m.vendorOrderNumber, lineNo: m.lineNo, name: m.lineName, max: m.goodQuantity + m.problemQuantity + (c?.capacity ?? 0) });
    start[m.vendorOrderLineId] = { good: String(m.goodQuantity + (c?.suggestedGoodQuantity ?? 0)), problem: String(m.problemQuantity + (c?.suggestedProblemQuantity ?? 0)) };
  }
  for (const c of candidates) {
    if (start[c.vendorOrderLineId]) continue;
    rows.push({ vendorOrderLineId: c.vendorOrderLineId, candidate: c, vendorOrderNumber: c.vendorOrderNumber, lineNo: c.lineNo, name: c.name, max: c.capacity });
    start[c.vendorOrderLineId] = { good: String(c.suggestedGoodQuantity), problem: String(c.suggestedProblemQuantity) };
  }
  return { rows, start };
}

function Form({ deliveryId, line, candidates, onClose }: { deliveryId: string; line: DeliveryLine; candidates: Candidate[]; onClose: () => void }) {
  const { t } = useTranslation('receiving');
  const save = useSetMatches(deliveryId);
  const [{ rows, start }] = useState(() => buildRows(line, candidates));
  const [values, setValues] = useState(start);
  const [restReason, setRestReason] = useState(() => t('match.overReason'));

  const parsed = rows.map((r) => ({ r, good: parseCount(values[r.vendorOrderLineId]?.good ?? ''), problem: parseCount(values[r.vendorOrderLineId]?.problem ?? '') }));
  const badCount = parsed.some((p) => p.good === null || p.problem === null);
  const sumGood = parsed.reduce((s, p) => s + (p.good ?? 0), 0);
  const sumProblem = parsed.reduce((s, p) => s + (p.problem ?? 0), 0);
  const tooMany = sumGood > line.goodQuantity || sumProblem > line.problemQuantity;
  // Over-delivery (spec 10.4, 17.2): a line takes at most what it lacks; the rest stays pending instead of failing.
  const matches: MatchRequest[] = [];
  let over = false;
  for (const { r, good, problem } of parsed) {
    const g = Math.min(good ?? 0, r.max);
    const p = Math.min(problem ?? 0, r.max - g);
    if ((good ?? 0) + (problem ?? 0) > r.max) over = true;
    if (g + p > 0) matches.push({ vendorOrderLineId: r.vendorOrderLineId, goodQuantity: g, problemQuantity: p });
  }
  const set = (id: string, k: 'good' | 'problem', v: string) => setValues({ ...values, [id]: { ...(values[id] ?? { good: '', problem: '' }), [k]: v } });
  const submit = (markRest?: string) => save.mutate({ lineId: line.id, matches, markRest }, { onSuccess: onClose });

  return (
    <Stack gap="4">
      <Text fontSize="sm">{t('match.help', { good: line.goodQuantity, problem: line.problemQuantity })}</Text>
      {rows.length === 0 && <Text color="fg.muted">{t('candidates.none')}</Text>}
      {parsed.map(({ r, good, problem }, i) => {
        const v = values[r.vendorOrderLineId] ?? { good: '', problem: '' };
        const extra = (good ?? 0) + (problem ?? 0) - r.max;
        return (
          <Stack key={r.vendorOrderLineId} gap="2">
            {i > 0 && <Separator />}
            <CandidateLabel
              vendorOrderNumber={r.vendorOrderNumber} vendorName={r.candidate?.vendorName} lineNo={r.lineNo} name={r.name} sku={r.candidate?.sku}
              capacity={r.max} matchedBy={r.candidate?.matchedBy}
            />
            <HStack gap="3" align="flex-start">
              <FormField label={t('match.good')} errorText={good === null ? t('box.countInvalid') : undefined} flex="1">
                <Input value={v.good} inputMode="numeric" aria-label={t('match.goodFor', { n: r.lineNo, order: r.vendorOrderNumber })} onChange={(e) => set(r.vendorOrderLineId, 'good', e.currentTarget.value)} />
              </FormField>
              <FormField label={t('match.problem')} errorText={problem === null ? t('box.countInvalid') : undefined} flex="1" disabled={line.problemQuantity === 0}>
                <Input value={v.problem} inputMode="numeric" aria-label={t('match.problemFor', { n: r.lineNo, order: r.vendorOrderNumber })} onChange={(e) => set(r.vendorOrderLineId, 'problem', e.currentTarget.value)} />
              </FormField>
            </HStack>
            {extra > 0 && (
              <Alert.Root status="warning" size="sm">
                <Alert.Indicator />
                <Alert.Description>{t('match.overHint', { short: r.max, extra })}</Alert.Description>
              </Alert.Root>
            )}
          </Stack>
        );
      })}
      <Text fontSize="sm" color={tooMany ? 'fg.error' : 'fg.muted'}>
        {t('match.totals', { good: sumGood, goodOf: line.goodQuantity, problem: sumProblem, problemOf: line.problemQuantity })}
      </Text>
      {tooMany && <Text fontSize="sm" color="fg.error">{t('match.tooMany')}</Text>}
      {over && (
        <FormField label={t('match.restReason')} helperText={t('match.restHelp')}>
          <Textarea value={restReason} rows={2} autoresize onChange={(e) => setRestReason(e.currentTarget.value)} />
        </FormField>
      )}
      <BlockerList error={save.error} />
      <ErrorAlert error={save.error} />
      <HStack justify="flex-end" wrap="wrap" gap="2">
        <Button variant="outline" onClick={onClose}>{t('common:actions.cancel')}</Button>
        {over && (
          <Button variant="outline" loading={save.isPending} disabled={badCount || tooMany || !restReason.trim()} onClick={() => submit(restReason.trim())}>
            {t('match.saveAndMarkRest')}
          </Button>
        )}
        <Button colorPalette="brand" loading={save.isPending} disabled={badCount || tooMany} onClick={() => submit()}>{t('match.save')}</Button>
      </HStack>
    </Stack>
  );
}

function Loader({ deliveryId, line, onClose }: { deliveryId: string; line: DeliveryLine; onClose: () => void }) {
  const suggestions = useSuggestions(line.id);
  if (suggestions.isPending) return <Skeleton h="24" rounded="l2" />;
  if (suggestions.error) return <ErrorAlert error={suggestions.error} />;
  return <Form deliveryId={deliveryId} line={line} candidates={suggestions.data} onClose={onClose} />;
}

/** The matches of one delivery line, opened on the system's suggested split (spec 17.2) and saved all or nothing. */
export function MatchEditor({ deliveryId, line, onClose }: { deliveryId: string; line: DeliveryLine | null; onClose: () => void }) {
  const { t } = useTranslation('receiving');
  return (
    <AppDialog open={!!line} onClose={onClose} size="lg" title={line ? t('match.title', { n: line.lineNo, name: line.name || line.sku }) : ''}>
      {line && <Loader deliveryId={deliveryId} line={line} onClose={onClose} />}
    </AppDialog>
  );
}
