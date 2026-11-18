import { Alert, Button, Dialog, Group, Input, NativeSelect, SimpleGrid, Stack, Text, Textarea } from '@chakra-ui/react';
import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useAddItem, usePutItem } from '../../api/batches';
import { useApi } from '../../api/context';
import { errorMessage } from '../../api/errors';
import { useVendors } from '../../api/vendors';
import { useMeta } from '../../api/meta';
import type { Batch, Item, Team } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { AppDialog, DialogFooter } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { useFieldError } from '../../components/ui/form';
import { SelectField } from '../../components/ui/select';
import { PRIORITIES, priorityLabel } from '../teams/priority';
import { emptyItemForm, itemFormSchema, itemToForm, safeHttpUrl, toItemRequest, type ItemForm } from './itemForm';
import { FORM_TO_LOOKUP_FIELD, LOOKUP_PROVIDER, planLookupFill, type LookupField, type LookupPatch, type LookupResult } from './productLookup';

interface Props {
  open: boolean;
  onClose: () => void;
  batch: Batch;
  team: Team | undefined;
  /** Caller's default subgroup in this team (used for new items). */
  defaultSubgroupId: string;
  item?: Item;
  /** A withdrawn item whose content prefills a new item (copy as new item). */
  prefill?: Item;
}

function Inner({ onClose, batch, team, defaultSubgroupId, item, prefill }: Omit<Props, 'open'>) {
  const { t } = useTranslation('batches');
  const meta = useMeta();
  const vendors = useVendors();
  const add = useAddItem(batch.id);
  const patch = usePutItem();
  const currencies = meta.data?.supportedCurrencies ?? [];
  const base = meta.data?.baseCurrency ?? currencies[0] ?? '';
  const activeDefault = team?.subgroups.some((g) => g.id === defaultSubgroupId && g.active) ? defaultSubgroupId : '';
  const form = useForm<ItemForm>({
    resolver: zodResolver(itemFormSchema),
    defaultValues: item ? itemToForm(item) : prefill ? itemToForm(prefill) : emptyItemForm(base, activeDefault),
  });
  const vendorChoice = useWatch({ control: form.control, name: 'vendorId' });
  const err = form.formState.errors;
  const fieldError = useFieldError();
  const mutation = item ? patch : add;
  const label = (k: string) => priorityLabel(team?.priorityLabels, k as '1', (x) => t(`teams:priority.default.${x}`));
  // Product lookup (spec 14.3): fills empty fields, asks before overwriting, marks what it filled until edited.
  const api = useApi();
  const lookupEnabled = meta.data?.lookupEnabled === true;
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<unknown>(null);
  const [lookupNote, setLookupNote] = useState('');
  const [pending, setPending] = useState<LookupPatch[]>([]);
  const [autoFilled, setAutoFilled] = useState<LookupField[]>([]);
  const applyPatches = (patches: LookupPatch[]) => {
    for (const p of patches) {
      for (const [k, v] of Object.entries(p.values)) form.setValue(k as keyof ItemForm, v, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
    }
    setAutoFilled((cur) => [...new Set([...cur, ...patches.map((p) => p.field)])]);
  };
  useEffect(() => {
    // Only the user's own edits (type "change") end the mark; setValue calls from the lookup do not.
    return form.subscribe({
      formState: { values: true },
      callback: ({ name, type }) => {
        const f = name && type === 'change' ? FORM_TO_LOOKUP_FIELD[name as keyof ItemForm] : undefined;
        if (f) setAutoFilled((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : cur));
      },
    });
  }, [form]);
  // Lookup first: a new item starts with just a query box; product fields stay in form state while hidden.
  const lookupFirst = lookupEnabled && !item && !prefill;
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const showProduct = !lookupFirst || expanded;
  const lookupSeq = useRef(0);
  const runLookup = async (q: string) => {
    q = q.trim();
    if (!q) return;
    // Seed the URL or SKU field from the query when empty (a result fills them anyway when it has them).
    if (safeHttpUrl(q)) {
      if (!form.getValues('productUrl').trim()) form.setValue('productUrl', q, { shouldDirty: true });
    } else if (!form.getValues('sku').trim()) form.setValue('sku', q, { shouldDirty: true });
    const seq = ++lookupSeq.current;
    setLookupBusy(true);
    setLookupError(null);
    setLookupNote('');
    setPending([]);
    try {
      const r = await api.get<LookupResult>('/lookup', { query: { q } });
      if (seq !== lookupSeq.current) return;
      const { fills, conflicts } = planLookupFill(form.getValues(), r, currencies);
      applyPatches(fills);
      setPending(conflicts);
      setExpanded(true);
      setLookupNote(r.inStock === true ? t('lookup.inStock') : r.inStock === false ? t('lookup.outOfStock') : '');
    } catch (e) {
      if (seq === lookupSeq.current) {
        setLookupError(e);
        setExpanded(true);
      }
    } finally {
      if (seq === lookupSeq.current) setLookupBusy(false);
    }
  };
  const onUrlPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text').trim();
    if (lookupEnabled && safeHttpUrl(text)) void runLookup(text);
  };
  const mark = (f: LookupField) => (autoFilled.includes(f) ? t('lookup.autoFilled') : undefined);
  const submit = form.handleSubmit((v) => {
    const body = { ...toItemRequest(v), ...(!item && autoFilled.length > 0 ? { autoFilledFields: autoFilled, lookupProvider: LOOKUP_PROVIDER } : {}) };
    if (item) patch.mutate({ item, body }, { onSuccess: onClose });
    else add.mutate(body, { onSuccess: onClose });
  }, () => setExpanded(true));
  const subgroups = (team?.subgroups ?? []).filter((g) => g.active || g.id === item?.subgroupId);
  return (
    <>
      <Dialog.Body>
        <form id="item-form" onSubmit={submit} noValidate>
          <Stack gap="3">
            {lookupFirst && !expanded && (
              <Stack gap="2">
                <FormField label={t('lookup.queryLabel')} helperText={t('lookup.queryHelp')}>
                  <Group attached w="full">
                    <Input flex="1" value={query} placeholder={t('lookup.queryPlaceholder')} onChange={(e) => setQuery(e.currentTarget.value)}
                      onPaste={onUrlPaste} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void runLookup(query); } }} />
                    <Button type="button" variant="outline" loading={lookupBusy} onClick={() => void runLookup(query)}>{t('lookup.action')}</Button>
                  </Group>
                </FormField>
                <Button type="button" size="xs" variant="ghost" alignSelf="start" onClick={() => setExpanded(true)}>{t('lookup.manual')}</Button>
              </Stack>
            )}
            {showProduct && (
              <>
                <FormField label={t('item.name')} required helperText={mark('name')} errorText={fieldError(err.name)}>
                  <Input {...form.register('name')} />
                </FormField>
                <SimpleGrid columns={{ base: 1, sm: 2 }} gap="3">
                  <Controller control={form.control} name="vendorId" render={({ field }) => (
                    <SelectField label={t('item.vendor')} helperText={mark('vendorId')} placeholder={t('item.noVendor')} name={field.name} value={field.value} onBlur={field.onBlur}
                      // Choosing a listed vendor fills in its default currency (still changeable afterwards).
                      onChange={(id) => {
                        field.onChange(id);
                        const currency = vendors.data?.find((v) => v.id === id)?.defaultCurrency;
                        if (currency && currencies.includes(currency)) form.setValue('currency', currency, { shouldDirty: true });
                      }}
                      options={[...(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name })), { value: 'other', label: t('item.vendorOther') }]} />
                  )} />
                  {vendorChoice === 'other' && (
                    <FormField label={t('item.vendorOtherName')}>
                      <Input {...form.register('vendorName')} />
                    </FormField>
                  )}
                  <FormField label={t('item.sku')} helperText={mark('sku')}>
                    <Input {...form.register('sku')} />
                  </FormField>
                </SimpleGrid>
                {/* Price and currency read as one input: the currency is the price's end addon. */}
                <FormField label={t('item.unitPrice')} required helperText={mark('estimatedUnitPrice')} errorText={fieldError(err.unitPrice) ?? fieldError(err.currency)}>
                  <Group attached w="full">
                    <Input flex="1" inputMode="decimal" {...form.register('unitPrice')} />
                    <Controller control={form.control} name="currency" render={({ field }) => (
                      <NativeSelect.Root width="auto" invalid={!!err.currency}>
                        <NativeSelect.Field
                          aria-label={t('item.currency')}
                          borderLeftRadius="0"
                          name={field.name}
                          value={field.value}
                          onChange={(e) => field.onChange(e.currentTarget.value)}
                          onBlur={field.onBlur}
                        >
                          {!field.value && <option value="" />}
                          {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                      </NativeSelect.Root>
                    )} />
                  </Group>
                </FormField>
                <FormField label={t('item.productUrl')} helperText={mark('productUrl') ?? (lookupEnabled ? t('lookup.help') : undefined)} errorText={fieldError(err.productUrl)}>
                  {lookupEnabled ? (
                    <Group attached w="full">
                      <Input flex="1" type="url" placeholder="https://" onPaste={onUrlPaste} {...form.register('productUrl')} />
                      <Button type="button" variant="outline" loading={lookupBusy}
                        onClick={() => void runLookup(form.getValues('productUrl') || form.getValues('sku'))}>
                        {t('lookup.action')}
                      </Button>
                    </Group>
                  ) : (
                    <Input type="url" placeholder="https://" {...form.register('productUrl')} />
                  )}
                </FormField>
              </>
            )}
            {lookupEnabled && lookupError != null && (
              <Alert.Root status="warning" role="status">
                <Alert.Indicator />
                <Alert.Content><Alert.Description>{errorMessage(t, lookupError)}</Alert.Description></Alert.Content>
              </Alert.Root>
            )}
            {lookupEnabled && pending.length > 0 && (
              <Alert.Root status="info" role="status">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Description>
                    {t('lookup.overwritePrompt', { fields: pending.map((p) => t(`lookup.fields.${p.field}`)).join(', ') })}
                  </Alert.Description>
                  <Group mt="2">
                    <Button size="xs" type="button" onClick={() => { applyPatches(pending); setPending([]); }}>{t('lookup.overwrite')}</Button>
                    <Button size="xs" type="button" variant="outline" onClick={() => setPending([])}>{t('lookup.keep')}</Button>
                  </Group>
                </Alert.Content>
              </Alert.Root>
            )}
            {lookupEnabled && lookupNote && <Text fontSize="sm" color="fg.muted">{lookupNote}</Text>}
            <SimpleGrid columns={{ base: 1, sm: 2 }} gap="3">
              <FormField label={t('item.quantity')} required errorText={fieldError(err.quantity)}>
                <Input inputMode="numeric" {...form.register('quantity')} />
              </FormField>
              <Controller control={form.control} name="priority" render={({ field }) => (
                <SelectField label={t('item.priority')} name={field.name} value={field.value} onChange={field.onChange} onBlur={field.onBlur} options={PRIORITIES.map((k) => ({ value: k, label: `${k} - ${label(k)}` }))} />
              )} />
              <Controller control={form.control} name="subgroupId" render={({ field }) => (
                <SelectField label={t('item.subgroup')} placeholder={t('item.noSubgroup')} name={field.name} value={field.value} onChange={field.onChange} onBlur={field.onBlur} options={subgroups.map((g) => ({ value: g.id, label: g.name }))} />
              )} />
            </SimpleGrid>
            <FormField label={t('item.purpose')} required errorText={fieldError(err.purpose)}>
              <Textarea autoresize rows={2} {...form.register('purpose')} />
            </FormField>
            <FormField label={t('item.notes')}>
              <Textarea autoresize rows={2} {...form.register('notes')} />
            </FormField>
            <ErrorAlert error={mutation.error} />
          </Stack>
        </form>
      </Dialog.Body>
      <DialogFooter>
        <Button size="sm" type="submit" form="item-form" loading={mutation.isPending}>{item ? t('common:actions.save') : t('item.add')}</Button>
      </DialogFooter>
    </>
  );
}

export function ItemFormModal(props: Props) {
  const { t } = useTranslation('batches');
  return (
    <AppDialog open={props.open} onClose={props.onClose} title={props.item ? t('item.editTitle') : t('item.addTitle')} size="lg">
      <Inner {...props} />
    </AppDialog>
  );
}
