import { Button, Card, HStack, Input, SimpleGrid, Stack } from '@chakra-ui/react';
import { PageHeader } from '@team6083/ui';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuPlus, LuSave } from 'react-icons/lu';
import { useNavigate } from 'react-router';
import { useCreateDelivery } from '../api/deliveries';
import { ErrorAlert } from '../components/ErrorAlert';
import { FormField } from '../components/ui/field';
import { todayLocal } from '../features/dates';
import { allocate, parseCount } from '../features/receiving/allocate';
import { BoxLineCard, emptyLine, lineErrors, type BoxLineDraft } from '../features/receiving/BoxLineCard';
import { RoleGuard } from '../components/PageStates';
import { useAccess } from '../auth/useAccess';
import { paths } from '../paths';

function NewDelivery() {
  const { t } = useTranslation('receiving');
  const navigate = useNavigate();
  const create = useCreateDelivery();
  const seq = useRef(1);
  const [receivedAt, setReceivedAt] = useState(() => todayLocal());
  const [source, setSource] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<BoxLineDraft[]>([emptyLine('l0')]);
  const [showErrors, setShowErrors] = useState(false);

  const update = (i: number) => (l: BoxLineDraft) => setLines(lines.map((x, j) => (j === i ? l : x)));
  const add = () => setLines([...lines, emptyLine(`l${seq.current++}`)]);
  const invalid = lines.some((l) => Object.values(lineErrors(l)).some(Boolean));

  const save = () => {
    setShowErrors(true);
    if (invalid) return;
    create.mutate(
      {
        receivedAt: receivedAt || undefined,
        source: source.trim(),
        note: note.trim(),
        lines: lines.map((l) => {
          const good = parseCount(l.good) ?? 0;
          const problem = parseCount(l.problem) ?? 0;
          const { matches } = allocate(l.chosen, good, problem);
          return {
            sku: l.sku.trim(), name: l.name.trim(), goodQuantity: good, problemQuantity: problem,
            problemType: problem > 0 ? l.problemType : '', problemNote: problem > 0 ? l.problemNote.trim() : '',
            ...(matches.length > 0 ? { matches } : {}),
          };
        }),
      },
      { onSuccess: (d) => void navigate(paths.delivery(d.id)) },
    );
  };

  return (
    <Stack gap="4">
      <PageHeader mb="0" title={t('box.title')} description={t('box.intro')} />
      <Card.Root size="sm">
        <Card.Body>
          <SimpleGrid columns={{ base: 1, md: 3 }} gap="3">
            <FormField label={t('box.receivedAt')}>
              <Input type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.currentTarget.value)} />
            </FormField>
            <FormField label={t('box.source')} helperText={t('box.sourceHelp')}>
              <Input value={source} onChange={(e) => setSource(e.currentTarget.value)} />
            </FormField>
            <FormField label={t('box.note')}>
              <Input value={note} onChange={(e) => setNote(e.currentTarget.value)} />
            </FormField>
          </SimpleGrid>
        </Card.Body>
      </Card.Root>

      {lines.map((l, i) => (
        <BoxLineCard
          key={l.key} index={i} line={l} showErrors={showErrors} onChange={update(i)}
          onRemove={lines.length > 1 ? () => setLines(lines.filter((_, j) => j !== i)) : undefined}
        />
      ))}

      <ErrorAlert error={create.error} />
      <HStack justify="space-between" wrap="wrap" gap="2">
        <Button size="sm" variant="outline" onClick={add}><LuPlus />{t('box.addLine')}</Button>
        <Button size="sm" loading={create.isPending} onClick={save}><LuSave />{t('box.save')}</Button>
      </HStack>
    </Stack>
  );
}

/** /deliveries/new: register one box line by line, phone first, matching on the spot or later. */
/** /deliveries/new: purchasers and receivers only; system admins may look at receiving but not register boxes. */
export function DeliveryNewPage() {
  const { t } = useTranslation('receiving');
  const { canSeeReceiving } = useAccess();
  return (
    <RoleGuard allow={(a) => a.canReceive} description={t(canSeeReceiving ? 'access.readOnly' : 'access.denied')}>
      <NewDelivery />
    </RoleGuard>
  );
}
