import { Suspense } from "react"
import type { Metadata } from "next"

import { Button } from "@/components/ui/button"
import { authCopy } from "@/lib/copy/auth"
import { createClient } from "@/lib/supabase/server"

import { signOutAction } from "./actions"

export const metadata: Metadata = {
  title: authCopy.me.title,
}

// Rendered inside the layout's <Suspense> customer gate.
export default function MePage() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <h1 className="font-heading text-2xl font-semibold">
        <Suspense fallback={authCopy.me.loading}>
          <Greeting />
        </Suspense>
      </h1>
      <form action={signOutAction}>
        <Button
          type="submit"
          variant="outline"
          size="lg"
          className="h-11 w-full text-base"
        >
          {authCopy.me.signOut}
        </Button>
      </form>
    </main>
  )
}

async function Greeting() {
  const supabase = await createClient()
  // RLS returns only the signed-in customer's own profile row.
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .maybeSingle()

  return authCopy.me.greeting(profile?.full_name ?? "")
}
