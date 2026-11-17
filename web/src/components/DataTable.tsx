import { DataTable as UiDataTable, type DataTableProps } from '@team6083/ui';

/**
 * @team6083/ui's DataTable with local fixes for its phone cards (remove once the package does this itself):
 * - cells without a label (the row's name, the checkbox) start at the left, without the empty label's gap;
 * - the checkbox sits beside the name, at the card's top left, instead of on a line of its own;
 * - long names wrap instead of running out of the card.
 */
export function DataTable<T>(props: DataTableProps<T>) {
  return (
    <UiDataTable<T>
      {...props}
      css={{
        '& td[data-label=""]': { justifyContent: 'flex-start' },
        '& td[data-label=""] > span': { textAlign: 'start' },
        '& td > span': { overflowWrap: 'anywhere' },
        '@media screen and (max-width: 47.99em)': {
          '& td[data-label=""]::before': { display: 'none' },
          '& tbody tr:has(> td[data-label=""]:first-child [data-scope="checkbox"])': { paddingInlineStart: '2.5rem' },
          '& tbody tr > td[data-label=""]:first-child:has([data-scope="checkbox"])': { position: 'absolute', insetInlineStart: '0.75rem', top: '0.7rem' },
          // Room for the ⋯ button at the card's top right.
          '& tbody tr > td[data-label=""]:not(:has([data-scope="checkbox"], [aria-haspopup]))': { paddingInlineEnd: '2rem' },
        },
      }}
    />
  );
}
