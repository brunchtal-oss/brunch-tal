import { adminCopy } from "@/lib/copy/admin"

import { toSessionTile } from "../home-items"
import { detailsSummary, loadEventDetails } from "../sessions/[id]/load-details"
import { HomeLink, HomeSection } from "./home-section"
import { loadHome } from "./load-home"
import { SessionTile } from "./session-tile"

const copy = adminCopy.home

// The two nearest sessions (story 4.1; design round, user decision
// 2026-10-07): a session-tile for the next one, with its places, babies
// and allergies (babies and allergies counted exactly as on the session
// page, from admin_get_event_details), and one for the session after it;
// then "לכל המפגשים". Occupied places come from the server. No session
// ahead: the existing empty line and link, inside a cube.
export async function NextSessions() {
  const { upcoming_sessions: sessions } = await loadHome()
  const [next, second] = sessions
  const details = next ? await loadEventDetails(next.event_id) : null

  if (!next || !details) {
    return (
      <HomeSection id="home-next" title={copy.nextSession}>
        <p className="text-base text-muted-foreground">{copy.noSessions}</p>
        <HomeLink href="/admin/sessions">{copy.toSessions}</HomeLink>
      </HomeSection>
    )
  }

  const { babies, allergies } = detailsSummary(details)
  return (
    <>
      <SessionTile session={toSessionTile(next)} next={{ babies, allergies }} />
      {second && <SessionTile session={toSessionTile(second)} />}
      <HomeLink href="/admin/sessions">{copy.allSessions}</HomeLink>
    </>
  )
}
