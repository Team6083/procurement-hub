import { Table } from '@chakra-ui/react';
import type { ReactNode } from 'react';

/** Bordered, horizontally scrollable table shell; the table keeps `minW` and scrolls on phones. */
export function TableShell({ minW, children, interactive, maxW }: { minW?: string; maxW?: string; interactive?: boolean; children: ReactNode }) {
  return (
    <Table.ScrollArea borderWidth="1px" rounded="md" maxW={maxW}>
      <Table.Root size="sm" interactive={interactive} minW={minW}>
        {children}
      </Table.Root>
    </Table.ScrollArea>
  );
}
