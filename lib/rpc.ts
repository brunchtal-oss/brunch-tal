import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { codeFromPostgrestError, type ActionResult } from "@/lib/errors"
import type { Database } from "@/lib/supabase/database.types"

// The single way TS calls an RPC (AD-17). Typed by the generated
// Database["public"]["Functions"], so a renamed parameter breaks the build.
// A P0001 exception with a known code becomes `{ ok: false, code }`; any other
// failure (unknown code, PostgREST or network error, thrown fetch) becomes
// SERVER_ERROR. The client is a parameter because there are three of them
// (session, service role, public). Only SERVER_ERROR is logged, with the RPC
// name and codes only, never the arguments (tokens, passwords, personal data).

type Functions = Database["public"]["Functions"]

export type RpcName = keyof Functions
export type RpcArgs<N extends RpcName> = Functions[N]["Args"]
export type RpcReturns<N extends RpcName> = Functions[N]["Returns"]

type RpcClient = Pick<SupabaseClient<Database>, "rpc">

// Functions without parameters (Args: never) take no args argument.
type ArgsParam<N extends RpcName> = [RpcArgs<N>] extends [never]
  ? []
  : [args: RpcArgs<N>]

type RawResult = {
  data: unknown
  error: { code?: string; message?: string } | null
}

export async function callRpc<N extends RpcName>(
  client: RpcClient,
  name: N,
  ...[args]: ArgsParam<N>
): Promise<ActionResult<RpcReturns<N>>> {
  let result: RawResult
  try {
    // The generic overloads of rpc() cannot follow a generic N; the name and
    // args are already checked against Database by this signature.
    const rpc = client.rpc.bind(client) as unknown as (
      fn: string,
      params?: object
    ) => PromiseLike<RawResult>
    result = await (args === undefined ? rpc(name) : rpc(name, args))
  } catch {
    console.error("rpc.failed", { rpc: name, code: "SERVER_ERROR" })
    return { ok: false, code: "SERVER_ERROR" }
  }

  if (result.error) {
    const code = codeFromPostgrestError(result.error)
    // A known business code (LINK_USED, ...) is an expected answer, not a
    // failure: only SERVER_ERROR is logged.
    if (code === "SERVER_ERROR") {
      console.error("rpc.failed", {
        rpc: name,
        code,
        dbCode: result.error.code ?? "unknown",
      })
    }
    return { ok: false, code }
  }

  return { ok: true, data: result.data as RpcReturns<N> }
}
