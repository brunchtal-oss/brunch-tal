import Link from "next/link"

import { adminCopy } from "@/lib/copy/admin"

import { toOpenRefund } from "../home-items"
import { HomeSection, cubeRows } from "./home-section"
import { loadHome } from "./load-home"

const copy = adminCopy.home

// Open refund requests (story 3.7), from admin_get_home.open_refunds, oldest
// first: "{customer} · {amount} · בראנץ׳ {concept} {DD.MM}", each to the
// customer's card (plain text while the purchase is not bound). A cube like
// the other parts, shown only while there is one; no "בוצע" before 3.9.
export async function OpenRefunds() {
  const { open_refunds: rows } = await loadHome()
  if (!rows || rows.length === 0) return null

  return (
    <HomeSection id="home-refunds" title={copy.openRefunds}>
      <ul className={cubeRows}>
        {rows.map((row) => {
          const item = toOpenRefund(row)
          return (
            <li key={item.key} className="py-3 text-base leading-[1.35]">
              {item.href ? (
                <Link
                  href={item.href}
                  className="rounded-lg underline underline-offset-[3px]"
                >
                  <bdi className="break-words">{item.text}</bdi>
                </Link>
              ) : (
                <bdi className="break-words">{item.text}</bdi>
              )}
            </li>
          )
        })}
      </ul>
    </HomeSection>
  )
}
