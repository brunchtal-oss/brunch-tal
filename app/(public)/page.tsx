import { HomeHero } from "@/components/public/home-hero"
import { getHomeHero } from "@/lib/content/home"

// The home page (story 5.1): the published hero (home › hero), read from the
// cache (content:home, updated on publish) through the anon client, so a
// draft never reaches it. Without a valid published hero: the business name
// only. Title: the root default.
export default async function HomePage() {
  return <HomeHero hero={await getHomeHero()} />
}
