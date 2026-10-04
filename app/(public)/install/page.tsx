import type { Metadata } from "next"
import Image from "next/image"

import { InstallGuide } from "@/components/public/install-guide"
import { PageHeading } from "@/components/shared/page-heading"
import { pwaCopy } from "@/lib/copy/pwa"
import { WORDMARK } from "@/lib/copy/shell"

const copy = pwaCopy.install

export const metadata: Metadata = { title: copy.title }

// /install (story 5.9): the install guide, linked from the public footer.
// On top, the icon with its name as it will sit on the home screen (the
// manifest's short_name), then the h1 and the intro, then a card per
// platform.
export default function InstallPage() {
  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col px-6 pt-10">
      <div className="flex flex-col items-center text-center">
        <figure className="flex flex-col items-center gap-1.5">
          <Image
            src="/icons/icon-192.png"
            alt=""
            width={64}
            height={64}
            className="rounded-[15px]"
          />
          <figcaption className="text-[13px] leading-[1.4] text-muted-foreground">
            {WORDMARK}
          </figcaption>
        </figure>
        <PageHeading className="mt-6 text-[34px] leading-[1.15] text-balance">
          {copy.title}
        </PageHeading>
        <p className="mt-3 text-[17px] leading-[1.65] text-muted-foreground">
          {copy.intro}
        </p>
      </div>
      <div className="mt-8">
        <InstallGuide />
      </div>
    </div>
  )
}
