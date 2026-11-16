import { Badge, HStack, Stack, Text } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';

interface Props {
  vendorOrderNumber: number;
  vendorName?: string;
  lineNo: number;
  name: string;
  sku?: string;
  /** Units the line can still take; omitted for a line that only holds an existing match. */
  capacity?: number;
  matchedBy?: 'sku' | 'name';
}

/** A vendor order line offered for matching: its order, its name and how much it still lacks. */
export function CandidateLabel({ vendorOrderNumber, vendorName, lineNo, name, sku, capacity, matchedBy }: Props) {
  const { t } = useTranslation('receiving');
  return (
    <Stack gap="0.5" minW="0">
      <Text fontWeight="medium" lineClamp={2}>{`#${lineNo} ${name}`}</Text>
      <HStack gap="2" wrap="wrap" fontSize="xs" color="fg.muted">
        <span>{vendorName ? `VO-${vendorOrderNumber} · ${vendorName}` : `VO-${vendorOrderNumber}`}</span>
        {sku && <span>{sku}</span>}
        {matchedBy === 'sku' && <Badge size="xs" variant="outline">{t('candidates.skuMatch')}</Badge>}
        {capacity !== undefined && <Badge size="xs" variant="subtle" colorPalette="brand">{t('candidates.capacity', { count: capacity })}</Badge>}
      </HStack>
    </Stack>
  );
}
