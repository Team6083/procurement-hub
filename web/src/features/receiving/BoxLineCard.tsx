import { Alert, Box, Card, Checkbox, HStack, IconButton, Input, SimpleGrid, Skeleton, Stack, Text } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { LuTrash2 } from 'react-icons/lu';
import { useMatchCandidates } from '../../api/deliveries';
import type { Candidate } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { FormField } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { allocate, parseCount, type Slot } from './allocate';
import { CandidateLabel } from './CandidateLabel';

export interface BoxLineDraft {
  key: string;
  sku: string;
  name: string;
  good: string;
  problem: string;
  problemType: '' | 'damaged' | 'wrong_item';
  problemNote: string;
  /** Vendor order lines picked for matching, in the order they were picked; cleared when the SKU or name changes. */
  chosen: Slot[];
}

export const emptyLine = (key: string): BoxLineDraft => ({ key, sku: '', name: '', good: '1', problem: '0', problemType: '', problemNote: '', chosen: [] });

/** What is wrong with a line before it can be saved, as receiving: translation keys. */
export function lineErrors(l: BoxLineDraft): { what?: string; good?: string; problem?: string; problemType?: string } {
  const good = parseCount(l.good);
  const problem = parseCount(l.problem);
  return {
    what: !l.sku.trim() && !l.name.trim() ? 'box.whatRequired' : undefined,
    good: good === null ? 'box.countInvalid' : good + (problem ?? 0) < 1 ? 'box.atLeastOne' : undefined,
    problem: problem === null ? 'box.countInvalid' : undefined,
    problemType: (problem ?? 0) > 0 && !l.problemType ? 'box.problemTypeRequired' : undefined,
  };
}

interface Props {
  index: number;
  line: BoxLineDraft;
  showErrors: boolean;
  onChange: (l: BoxLineDraft) => void;
  onRemove?: () => void;
}

/** One line of the box: what it is, how many, any damaged or wrong units, and live candidates to match it to. */
export function BoxLineCard({ index, line, showErrors, onChange, onRemove }: Props) {
  const { t } = useTranslation('receiving');
  const sku = useDebouncedValue(line.sku, 300);
  const name = useDebouncedValue(line.name, 300);
  const candidates = useMatchCandidates(sku, name);
  const set = (patch: Partial<BoxLineDraft>) => onChange({ ...line, ...patch });
  const errors = showErrors ? lineErrors(line) : {};
  const good = parseCount(line.good) ?? 0;
  const problem = parseCount(line.problem) ?? 0;
  const { matches, left } = allocate(line.chosen, good, problem);
  const shown: Candidate[] = candidates.data ?? [];
  const toggle = (c: Candidate, on: boolean) =>
    set({ chosen: on ? [...line.chosen, { vendorOrderLineId: c.vendorOrderLineId, capacity: c.capacity }] : line.chosen.filter((s) => s.vendorOrderLineId !== c.vendorOrderLineId) });

  return (
    <Card.Root size="sm" as="section" aria-label={t('box.lineN', { n: index + 1 })}>
      <Card.Header>
        <HStack justify="space-between">
          <Text fontWeight="semibold">{t('box.lineN', { n: index + 1 })}</Text>
          {onRemove && <IconButton size="xs" variant="ghost" aria-label={t('box.removeLine', { n: index + 1 })} onClick={onRemove}><LuTrash2 /></IconButton>}
        </HStack>
      </Card.Header>
      <Card.Body>
        <Stack gap="3">
          <SimpleGrid columns={{ base: 1, md: 2 }} gap="3">
            <FormField label={t('box.sku')} errorText={errors.what && t(errors.what)}>
              <Input value={line.sku} autoComplete="off" enterKeyHint="next" onChange={(e) => set({ sku: e.currentTarget.value, chosen: [] })} />
            </FormField>
            <FormField label={t('box.name')}>
              <Input value={line.name} autoComplete="off" onChange={(e) => set({ name: e.currentTarget.value, chosen: [] })} />
            </FormField>
          </SimpleGrid>
          <SimpleGrid columns={{ base: 2, md: 4 }} gap="3">
            <FormField label={t('box.good')} errorText={errors.good && t(errors.good)}>
              <Input value={line.good} inputMode="numeric" onChange={(e) => set({ good: e.currentTarget.value })} />
            </FormField>
            <FormField label={t('box.problem')} errorText={errors.problem && t(errors.problem)}>
              <Input value={line.problem} inputMode="numeric" onChange={(e) => set({ problem: e.currentTarget.value })} />
            </FormField>
            {problem > 0 && (
              <Box gridColumn="span 2">
                <SelectField
                  label={t('box.problemType')} placeholder={t('box.choose')} value={line.problemType} errorText={errors.problemType && t(errors.problemType)}
                  onChange={(v) => set({ problemType: v as BoxLineDraft['problemType'] })}
                  options={[{ value: 'damaged', label: t('problemType.damaged') }, { value: 'wrong_item', label: t('problemType.wrong_item') }]}
                />
              </Box>
            )}
          </SimpleGrid>
          {problem > 0 && (
            <FormField label={t('box.problemNote')}>
              <Input value={line.problemNote} onChange={(e) => set({ problemNote: e.currentTarget.value })} />
            </FormField>
          )}

          <Stack gap="2">
            <Text textStyle="sm" fontWeight="medium">{t('candidates.title')}</Text>
            {!candidates.isFetching && !candidates.data && <Text textStyle="sm" color="fg.muted">{t('candidates.typeToSearch')}</Text>}
            {candidates.isFetching && !candidates.data && <Skeleton h="10" rounded="l2" />}
            <ErrorAlert error={candidates.error} />
            {candidates.data && shown.length === 0 && <Text textStyle="sm" color="fg.muted">{t('candidates.none')}</Text>}
            {shown.map((c) => {
              const m = matches.find((x) => x.vendorOrderLineId === c.vendorOrderLineId);
              return (
                <Checkbox.Root
                  key={c.vendorOrderLineId} alignItems="flex-start" borderWidth="1px" rounded="l2" p="2"
                  checked={line.chosen.some((s) => s.vendorOrderLineId === c.vendorOrderLineId)} onCheckedChange={(e) => toggle(c, !!e.checked)}
                >
                  <Checkbox.HiddenInput />
                  <Checkbox.Control mt="0.5" />
                  <Checkbox.Label flex="1" minW="0">
                    <Stack gap="1">
                      <CandidateLabel {...c} />
                      {m && <Text textStyle="xs" color="fg.success">{t('candidates.willMatch', { good: m.goodQuantity, problem: m.problemQuantity })}</Text>}
                    </Stack>
                  </Checkbox.Label>
                </Checkbox.Root>
              );
            })}
            {line.chosen.length > 0 && left > 0 && (
              <Alert.Root status="warning" size="sm">
                <Alert.Indicator />
                <Alert.Description>{t('candidates.leftPending', { count: left })}</Alert.Description>
              </Alert.Root>
            )}
          </Stack>
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
