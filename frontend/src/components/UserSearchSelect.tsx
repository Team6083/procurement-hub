import { Select } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUserSearch } from '../api/members';
import type { User } from '../api/types';

interface Props {
  value: string | null;
  onChange: (userId: string | null) => void;
  label: string;
  error?: string;
  /** Users to hide (e.g. existing members). */
  excludeIds?: string[];
}

/** Searchable user picker backed by GET /users?q= (needs at least 2 characters). */
export function UserSearchSelect({ value, onChange, label, error, excludeIds = [] }: Props) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 250);
  const q = useUserSearch(debounced);
  const [picked, setPicked] = useState<User | null>(null);
  const users = (q.data ?? []).filter((u) => !excludeIds.includes(u.id));
  const data = [...(picked && !users.some((u) => u.id === picked.id) ? [picked] : []), ...users].map((u) => ({
    value: u.id,
    label: `${u.displayName || u.username} (${u.email || u.username})`,
  }));
  return (
    <Select
      label={label}
      searchable
      clearable
      data={data}
      value={value}
      error={error}
      filter={({ options }) => options}
      searchValue={search}
      onSearchChange={setSearch}
      onChange={(v) => {
        setPicked(users.find((u) => u.id === v) ?? null);
        onChange(v);
      }}
      placeholder={t('common:userSearch.placeholder')}
      nothingFoundMessage={
        debounced.trim().length < 2 ? t('common:userSearch.minChars') : q.isFetching ? t('loading') : t('common:userSearch.none')
      }
    />
  );
}
