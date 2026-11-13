import { Card, List, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useTeamCtx } from '../features/teams/TeamContext';

export function TeamOverview() {
  const { t } = useTranslation('teams');
  const { team, full } = useTeamCtx();
  return (
    <Stack>
      {team.description ? <Text>{team.description}</Text> : <Text c="dimmed">{t('team.noDescription')}</Text>}
      {full && (
        <Card withBorder>
          <Stack gap="xs">
            <Text size="sm">
              {t('general.visibility')}: {t(`team.visibility.${full.visibility}`)}
            </Text>
            <Text size="sm">
              {t('general.locale')}: {t(`common:language.${full.locale}`)}
            </Text>
            <Text fw={600} size="sm">{t('team.subgroups')}</Text>
            {full.subgroups.filter((g) => g.active).length === 0 ? (
              <Text size="sm" c="dimmed">{t('team.noSubgroups')}</Text>
            ) : (
              <List size="sm">
                {full.subgroups.filter((g) => g.active).map((g) => <List.Item key={g.id}>{g.name}</List.Item>)}
              </List>
            )}
          </Stack>
        </Card>
      )}
      <Card withBorder>
        <Text c="dimmed">{t('team.batchesPlaceholder')}</Text>
      </Card>
    </Stack>
  );
}
