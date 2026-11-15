import { Button, HStack, Stack, Textarea } from '@chakra-ui/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useReportException } from '../../api/receiving';
import type { ExceptionType, Item } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { AppDialog } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
import { EXCEPTION_TYPES, MAX_EXCEPTION_DESCRIPTION, checkException } from './rules';

interface Props {
  item: Item | null;
  batchId: string;
  onClose: () => void;
}

function Inner({ item, batchId, onClose }: Props & { item: Item }) {
  const { t } = useTranslation('receiving');
  const report = useReportException(batchId);
  const [type, setType] = useState<ExceptionType>('quantity_mismatch');
  const [description, setDescription] = useState('');
  const [touched, setTouched] = useState(false);
  const check = checkException(type, description);
  return (
    <Stack gap="4">
      <SelectField size="md" label={t('exception.type')} value={type} onChange={(v) => setType(v as ExceptionType)}
        options={EXCEPTION_TYPES.map((x) => ({ value: x, label: t(`exceptionType.${x}`) }))} />
      <FormField label={t('exception.description')} helperText={t('exception.descriptionHelp')} errorText={touched && check.descriptionError ? t(`validation.description.${check.descriptionError}`) : undefined}>
        <Textarea autoresize rows={3} maxLength={MAX_EXCEPTION_DESCRIPTION} value={description} onChange={(e) => setDescription(e.currentTarget.value)} onBlur={() => setTouched(true)} />
      </FormField>
      <ErrorAlert error={report.error} />
      <HStack justify="flex-end">
        <Button size="lg" variant="outline" onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button size="lg" colorPalette="red" loading={report.isPending} disabled={!check.valid} onClick={() => report.mutate({ item, body: check.body }, { onSuccess: onClose })}>
          {t('exception.submit')}
        </Button>
      </HStack>
    </Stack>
  );
}

export function ExceptionModal(props: Props) {
  const { t } = useTranslation('receiving');
  return (
    <AppDialog open={!!props.item} onClose={props.onClose} title={t('exception.title', { name: props.item?.name })}>
      {props.item && <Inner {...props} item={props.item} />}
    </AppDialog>
  );
}
