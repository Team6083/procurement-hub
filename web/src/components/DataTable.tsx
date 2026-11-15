import { DataTable as UiDataTable, type DataTableProps } from '@team6083/ui';

/**
 * @team6083/ui's DataTable with one local fix: on a phone its cards right-align the cells without a label (the row's
 * name, the checkbox), so the card's title sat at the right edge. Those cells start at the left here.
 * Remove once the package does this itself.
 */
export function DataTable<T>(props: DataTableProps<T>) {
  return (
    <UiDataTable<T>
      {...props}
      css={{
        '& td[data-label=""]': { justifyContent: 'flex-start' },
        '& td[data-label=""] > span': { textAlign: 'start' },
      }}
    />
  );
}
