import { Field, type BoxProps } from '@chakra-ui/react';
import type { ReactNode } from 'react';

export interface FieldProps {
  label?: ReactNode;
  helperText?: ReactNode;
  errorText?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  children: ReactNode;
  flex?: BoxProps['flex'];
  w?: BoxProps['w'];
}

/** Label, control, help and error text wired together (ids, aria-describedby, aria-invalid). */
export function FormField({ label, helperText, errorText, required, disabled, children, flex, w }: FieldProps) {
  return (
    <Field.Root invalid={!!errorText} required={required} disabled={disabled} flex={flex} w={w}>
      {label && (
        <Field.Label>
          {label}
          {required && <Field.RequiredIndicator />}
        </Field.Label>
      )}
      {children}
      {helperText && <Field.HelperText>{helperText}</Field.HelperText>}
      {errorText && <Field.ErrorText>{errorText}</Field.ErrorText>}
    </Field.Root>
  );
}
