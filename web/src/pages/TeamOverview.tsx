import { Card, List, Stack, Text } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { useTeamCtx } from '../features/teams/TeamContext';

export function TeamOverview() {
  const { t } = useTranslation('teams');
  const { team, full } = useTeamCtx();
  const active = full?.subgroups.filter((g) => g.active) ?? [];
  return (
    <Stack gap="4">
      {team.description ? <Text whiteSpace="pre-wrap">{team.description}</Text> : <Text color="fg.muted">{t('team.noDescription')}</Text>}
      {full && (
        <Card.Root variant="outline">
          <Card.Body p="4">
            <Stack gap="2">
              <Text fontSize="sm">
                {t('general.visibility')}: {t(`team.visibility.${full.visibility}`)}
              </Text>
              <Text fontSize="sm">
                {t('general.locale')}: {t(`common:language.${full.locale}`)}
              </Text>
              <Text fontWeight="semibold" fontSize="sm">{t('team.subgroups')}</Text>
              {active.length === 0 ? (
                <Text fontSize="sm" color="fg.muted">{t('team.noSubgroups')}</Text>
              ) : (
                <List.Root fontSize="sm" ps="4">
                  {active.map((g) => <List.Item key={g.id}>{g.name}</List.Item>)}
                </List.Root>
              )}
            </Stack>
          </Card.Body>
        </Card.Root>
      )}
      <Card.Root variant="outline">
        <Card.Body p="4">
          <Text color="fg.muted">{t('team.batchesPlaceholder')}</Text>
        </Card.Body>
      </Card.Root>
    </Stack>
  );
}
