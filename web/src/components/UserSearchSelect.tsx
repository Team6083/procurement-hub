import { Combobox, Portal, createListCollection } from '@chakra-ui/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUserSearch } from '../api/members';
import type { User } from '../api/types';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { FormField } from './ui/field';

interface Props {
  value: string | null;
  onChange: (userId: string | null) => void;
  label: string;
  error?: string;
  /** Users to hide (e.g. existing members). */
  excludeIds?: string[];
}

const userLabel = (u: User) => `${u.displayName || u.username} (${u.email || u.username})`;

/** Searchable user picker backed by GET /users?q= (needs at least 2 characters). */
export function UserSearchSelect({ value, onChange, label, error, excludeIds = [] }: Props) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, 250);
  const q = useUserSearch(debounced);
  const [picked, setPicked] = useState<User | null>(null);
  const users = (q.data ?? []).filter((u) => !excludeIds.includes(u.id));
  const options = [...(picked && picked.id === value && !users.some((u) => u.id === picked.id) ? [picked] : []), ...users];
  const collection = createListCollection({ items: options, itemToValue: (u) => u.id, itemToString: userLabel });
  const empty = debounced.trim().length < 2 ? t('common:userSearch.minChars') : q.isFetching ? t('loading') : t('common:userSearch.none');
  return (
    <FormField errorText={error}>
      <Combobox.Root
        collection={collection}
        value={value ? [value] : []}
        onInputValueChange={(e) => {
          if (e.reason === 'input-change' || e.reason === 'clear-trigger') setSearch(e.inputValue);
        }}
        onValueChange={(e) => {
          const id = e.value[0] ?? null;
          setPicked(options.find((u) => u.id === id) ?? null);
          onChange(id);
        }}
        openOnClick
        size="sm"
        invalid={!!error}
      >
        <Combobox.Label>{label}</Combobox.Label>
        <Combobox.Control>
          <Combobox.Input placeholder={t('common:userSearch.placeholder')} />
          <Combobox.IndicatorGroup>
            <Combobox.ClearTrigger />
            <Combobox.Trigger />
          </Combobox.IndicatorGroup>
        </Combobox.Control>
        <Portal>
          <Combobox.Positioner>
            <Combobox.Content>
              <Combobox.Empty>{empty}</Combobox.Empty>
              {collection.items.map((u) => (
                <Combobox.Item key={u.id} item={u}>
                  <Combobox.ItemText>{userLabel(u)}</Combobox.ItemText>
                  <Combobox.ItemIndicator />
                </Combobox.Item>
              ))}
            </Combobox.Content>
          </Combobox.Positioner>
        </Portal>
      </Combobox.Root>
    </FormField>
  );
}
