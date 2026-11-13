import { Center, Code, Heading, Stack, Text } from '@chakra-ui/react';
import type { ReactNode } from 'react';

/** Full-screen message used before the app chrome exists (config error, sign-in failure, no access). */
export function StatusPage({ title, body, details, note, children }: { title: string; body: string; details?: string; note?: string; children?: ReactNode }) {
  return (
    <Center minH="100vh" p="4" as="main">
      <Stack align="center" maxW="560px" w="full" gap="4" textAlign="center">
        <Heading as="h1" size="xl">{title}</Heading>
        <Text>{body}</Text>
        {note && <Text fontSize="sm" color="fg.muted">{note}</Text>}
        {details && (
          <Code colorPalette="gray" display="block" whiteSpace="pre-wrap" wordBreak="break-word" textAlign="start" p="3" w="full">
            {details}
          </Code>
        )}
        {children}
      </Stack>
    </Center>
  );
}
