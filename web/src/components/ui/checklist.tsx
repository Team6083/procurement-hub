import { Box, Checkbox, CheckboxGroup, Fieldset, Stack, Text } from '@chakra-ui/react';
import type { Option } from './select';

/** Multi-select as a scrollable checkbox list: works with touch and keyboard alike. */
export function Checklist({ label, options, value, onChange, emptyText }: { label: string; options: Option[]; value: string[]; onChange: (v: string[]) => void; emptyText?: string }) {
  return (
    <Fieldset.Root>
      <Fieldset.Legend textStyle="sm" fontWeight="medium">{label}</Fieldset.Legend>
      <CheckboxGroup value={value} onValueChange={onChange}>
        <Box maxH="40" overflowY="auto" borderWidth="1px" rounded="md" px="3" py="2">
          {options.length === 0 && emptyText && <Text textStyle="sm" color="fg.muted">{emptyText}</Text>}
          <Stack gap="1.5">
            {options.map((o) => (
              <Checkbox.Root key={o.value} value={o.value} size="sm">
                <Checkbox.HiddenInput />
                <Checkbox.Control />
                <Checkbox.Label>{o.label}</Checkbox.Label>
              </Checkbox.Root>
            ))}
          </Stack>
        </Box>
      </CheckboxGroup>
    </Fieldset.Root>
  );
}
