import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { AppError, CommandArgs, CommandName, CommandResult } from "@contract";
import { call } from "./commands";

type ArgsOrUndefined<K extends CommandName> = string extends keyof CommandArgs<K> ? undefined : CommandArgs<K>;

interface QueryOptions {
  enabled?: boolean;
  staleTime?: number;
  refetchInterval?: number | false;
  retry?: boolean | number;
  /** Beim Wechsel der Argumente das letzte Ergebnis stehen lassen (kein Flackern) */
  keepPrevious?: boolean;
}

/** Schlüssel = Command-Name + Argumente. Ereignisse invalidieren über den Command-Namen (ARCHITEKTUR 3.5). */
export function queryKey(cmd: CommandName, args?: unknown): readonly unknown[] {
  return args === undefined ? [cmd] : [cmd, args];
}

export function useCmd<K extends CommandName>(
  cmd: K,
  args: ArgsOrUndefined<K>,
  options: QueryOptions = {},
): UseQueryResult<CommandResult<K>, AppError> {
  const { keepPrevious, ...rest } = options;
  return useQuery<CommandResult<K>, AppError>({
    queryKey: queryKey(cmd, args),
    ...(keepPrevious ? { placeholderData: keepPreviousData } : {}),
    queryFn: () =>
      args === undefined
        ? (call as (c: K) => Promise<CommandResult<K>>)(cmd)
        : (call as (c: K, a: unknown) => Promise<CommandResult<K>>)(cmd, args),
    ...rest,
  });
}

/** Mutation für einen Command; invalidiert danach die genannten Commands. */
export function useCmdMutation<K extends CommandName>(
  cmd: K,
  invalidate: CommandName[] = [],
): UseMutationResult<CommandResult<K>, AppError, ArgsOrUndefined<K>> {
  const qc = useQueryClient();
  return useMutation<CommandResult<K>, AppError, ArgsOrUndefined<K>>({
    mutationFn: (args) =>
      args === undefined
        ? (call as (c: K) => Promise<CommandResult<K>>)(cmd)
        : (call as (c: K, a: unknown) => Promise<CommandResult<K>>)(cmd, args),
    onSettled: () => {
      for (const name of invalidate) void qc.invalidateQueries({ queryKey: [name] });
    },
  });
}
