import { createListCollection, Portal, Select } from '@chakra-ui/react';
import { useMemo } from 'react';

export interface FilterOption {
  value: string;
  label: string;
}

/** Stands for the "All" choice: a single-value Select cannot be emptied by clicking, so clearing is an item of its own. */
const ALL = '__all__';

function Parts({ label, placeholder, items }: { label: string; placeholder?: string; items: FilterOption[] }) {
  return (
    <>
      <Select.HiddenSelect />
      <Select.Label>{label}</Select.Label>
      <Select.Control>
        <Select.Trigger>
          <Select.ValueText placeholder={placeholder} />
        </Select.Trigger>
        <Select.IndicatorGroup>
          <Select.Indicator />
        </Select.IndicatorGroup>
      </Select.Control>
      <Portal>
        <Select.Positioner>
          <Select.Content>
            {items.map((item) => (
              <Select.Item key={item.value} item={item}>
                {item.label}
                <Select.ItemIndicator />
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Positioner>
      </Portal>
    </>
  );
}

/** One-value filter field for a FilterBar. `value` "" means no filter; the first item (`allLabel`) clears it. */
export function FilterSelect({ label, value, onChange, options, allLabel }: {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
  options: FilterOption[];
  allLabel: string;
}) {
  const items = useMemo(() => [{ value: ALL, label: allLabel }, ...options], [allLabel, options]);
  const collection = useMemo(() => createListCollection({ items }), [items]);
  return (
    <Select.Root collection={collection} size="sm" value={[value || ALL]} onValueChange={(e) => onChange(e.value[0] && e.value[0] !== ALL ? e.value[0] : '')}>
      <Parts label={label} items={items} />
    </Select.Root>
  );
}

/** Several-values filter field for a FilterBar; an empty selection means no filter. */
export function FilterMultiSelect({ label, value, onChange, options, placeholder }: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  options: FilterOption[];
  placeholder: string;
}) {
  const collection = useMemo(() => createListCollection({ items: options }), [options]);
  return (
    <Select.Root multiple collection={collection} size="sm" value={value} onValueChange={(e) => onChange(e.value)}>
      <Parts label={label} placeholder={placeholder} items={options} />
    </Select.Root>
  );
}
