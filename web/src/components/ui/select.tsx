import { NativeSelect, type BoxProps } from '@chakra-ui/react';
import type { ReactNode } from 'react';
import { FormField } from './field';

export interface Option<T extends string = string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  label?: ReactNode;
  'aria-label'?: string;
  helperText?: ReactNode;
  errorText?: ReactNode;
  value: T | '' | null | undefined;
  /** Receives "" when the placeholder option (if any) is chosen. */
  onChange: (value: T | '') => void;
  onBlur?: () => void;
  name?: string;
  options: (Option<T> | T)[];
  /** Shown as an empty first option; choosing it clears the value. */
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  size?: 'xs' | 'sm' | 'md';
  w?: BoxProps['w'];
}

/**
 * Native <select> with Chakra styling: keyboard and screen-reader friendly, and it opens the
 * platform picker on phones.
 */
export function SelectField<T extends string = string>({ label, helperText, errorText, value, onChange, onBlur, name, options, placeholder, disabled, required, size = 'md', w, ...rest }: Props<T>) {
  return (
    <FormField label={label} helperText={helperText} errorText={errorText} disabled={disabled} required={required} w={w}>
      <NativeSelect.Root size={size} disabled={disabled}>
        <NativeSelect.Field
          aria-label={rest['aria-label']}
          name={name}
          value={value ?? ''}
          onChange={(e) => onChange(e.currentTarget.value as T | '')}
          onBlur={onBlur}
        >
          {(placeholder !== undefined || !value) && <option value="">{placeholder ?? ''}</option>}
          {options.map((o) => {
            const opt = typeof o === 'string' ? { value: o, label: o } : o;
            return (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            );
          })}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
    </FormField>
  );
}
