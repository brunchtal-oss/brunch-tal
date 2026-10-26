// Story 5.22: the fictional world of the explainer videos, as data only.
// Read by scripts/video-seed.mjs and checked by scripts/video-cast-rules.mjs
// (user guidelines 1–4, capacities, validity, babies, credits, copy).
//
// Every name, phone and note here is invented: emails on video.example.com
// (a subdomain of a reserved domain) and phones 03-00002NN (a local number
// starting with 0 that is not allocated in Israel). Babies' ages are days
// before the run day. Session keys are those of planVideoDates
// (scripts/video-plan.mjs): U1–U8 upcoming Mondays/Thursdays, F1–F2 upcoming
// Fridays, H1–H4 past Mondays/Thursdays (oldest first), HF the last Friday,
// H0 the Monday 17 weeks back.

export { VIDEO_DOMAIN } from "./dev-guard.mjs"

// The filming admin (D2): every row it makes belongs to the world.
export const FILMING_ADMIN_EMAIL = "admin@video.example.com"

// Explicit capacities (today's defaults), so the occupancy targets do not
// depend on an editable setting.
export const CAPACITY = { regular: 12, couple: 14 }

// Regular sessions take their concept from the weekday; Friday sessions
// rotate between the couple concepts (theme_key, never the name).
export const WEEKDAY_THEMES = { 1: "mothers", 4: "greek" }

// target: confirmed places at the end of the seed (a couple counts 2).
export const SESSIONS = {
  U1: { target: 8 },
  U2: { target: 12 },
  U3: { cancelledByBusiness: true },
  U4: { target: 9 },
  U5: { target: 2 },
  U6: { target: 4 },
  U7: { target: 1 },
  U8: { draft: true, target: 0 },
  F1: { theme: "couples", target: 4 },
  F2: { theme: "grandma", target: 2 },
  H1: { target: 6 },
  H2: { target: 6 },
  H3: { target: 6 },
  H4: { target: 6 },
  HF: { theme: "grandpa", target: 4 },
  H0: { target: 1 },
}

export function sessionKind(key) {
  return /^(F\d|HF)$/.test(key) ? "couple" : "regular"
}

// The three customer logins of the videos (password per D3).
export const LOGINS = ["michal", "neta", "sivan"]

// purchases[0] comes with the join link (a new customer); later purchases
// are for the existing customer. paid: { daysAgo } before the run day,
// { historyWeek } days after the Sunday of H1's week, { beforeEvent } before
// the real date of its session, or { expiresIn } (a card that ends that many
// days after the run day). A card starts no earlier than H1's week (or has
// validFromHistory: its validity starts there, DW3), so job_auto_extend
// finds a session in every week of it and extends nothing (rule
// "auto-extend"). joins: false = a payer who has not joined (no account).
// expiredLink: her link expired (DW4).
export const PERSONAS = [
  {
    key: "michal",
    fullName: "מיכל אהרוני",
    email: "michal.aharoni",
    phone: "03-0000201",
    photoConsent: true,
    personalPhotoConsent: true,
    dietaryNotes: "בלי מוצרי חלב",
    babies: [{ name: "נעמה", ageDays: 132 }],
    purchases: [
      { product: "card", paid: { historyWeek: 2 } },
      { product: "couple", event: "F1", paid: { daysAgo: 5 } },
    ],
  },
  {
    key: "neta",
    fullName: "נטע ברגר",
    email: "neta.berger",
    phone: "03-0000202",
    photoConsent: true,
    personalPhotoConsent: false,
    dietaryNotes: null,
    babies: [{ name: "יואב", ageDays: 98 }],
    purchases: [
      { product: "single", event: "H1", paid: { beforeEvent: 3 } },
      { product: "single", event: "U5", paid: { daysAgo: 2 } },
    ],
  },
  {
    key: "sivan",
    fullName: "סיוון אשכנזי",
    email: "sivan.ashkenazi",
    phone: "03-0000203",
    photoConsent: false,
    personalPhotoConsent: false,
    dietaryNotes: null,
    babies: [{ name: "אגם", ageDays: 77 }],
    purchases: [{ product: "single", event: "U3", paid: { daysAgo: 3 } }],
  },
  {
    key: "orit",
    fullName: "אורית נחום",
    email: "orit.nahum",
    phone: "03-0000204",
    photoConsent: true,
    personalPhotoConsent: true,
    dietaryNotes: null,
    babies: [{ name: "אלמה", ageDays: 186 }],
    // Ends in 7 days, so paid 42 days back, before the history: its
    // validity starts with the history (DW3; no screen shows valid_from).
    purchases: [{ product: "card", paid: { expiresIn: 7 }, validFromHistory: true }],
  },
  {
    key: "adi",
    fullName: "עדי מלכה",
    email: "adi.malka",
    phone: "03-0000205",
    photoConsent: true,
    personalPhotoConsent: false,
    dietaryNotes: null,
    babies: [{ name: "איתן", ageDays: 115 }],
    purchases: [{ product: "single", event: "U4", paid: { daysAgo: 4 } }],
  },
  {
    key: "reut",
    fullName: "רעות גבאי",
    email: "reut.gabay",
    phone: "03-0000206",
    photoConsent: false,
    personalPhotoConsent: true,
    dietaryNotes: null,
    babies: [{ name: "מאור", ageDays: 143 }],
    purchases: [{ product: "single", event: "U6", paid: { daysAgo: 6 } }],
  },
  {
    key: "yarden",
    fullName: "ירדן שושן",
    email: "yarden.shushan",
    phone: "03-0000207",
    photoConsent: true,
    personalPhotoConsent: true,
    dietaryNotes: null,
    babies: [{ name: "הלל", ageDays: 89 }],
    purchases: [{ product: "single", event: "U7", paid: { daysAgo: 8 } }],
  },
  {
    key: "hila",
    fullName: "הילה כץ",
    email: "hila.katz",
    phone: "03-0000208",
    photoConsent: true,
    personalPhotoConsent: false,
    dietaryNotes: "אלרגיה לאגוזים",
    babies: [{ name: "רום", ageDays: 61 }],
    purchases: [{ product: "intro", event: "U2", paid: { daysAgo: 2 } }],
  },
  {
    key: "moran",
    fullName: "מורן סויסה",
    email: "moran.suissa",
    phone: "03-0000209",
    photoConsent: false,
    personalPhotoConsent: false,
    dietaryNotes: null,
    babies: [{ name: "ליבי", ageDays: 158 }],
    purchases: [{ product: "single", event: "H2", paid: { beforeEvent: 4 } }],
  },
  {
    // Paid for U1 and has not joined: "ממתינה להצטרפות" on U1, live link.
    key: "shani",
    fullName: "שני אלמוג",
    joins: false,
    purchases: [{ product: "single", event: "U1", paid: { daysAgo: 1 } }],
  },
  {
    // Paid for a card and has not joined: the live join of video 4. The
    // email and phone are the ones she types on the form while filming.
    key: "chen",
    fullName: "חן לוינסון",
    joins: false,
    liveEmail: "chen.levinson",
    livePhone: "03-0000211",
    purchases: [{ product: "card", paid: { daysAgo: 0 } }],
  },
  {
    // Paid for U5, never joined, and her link expired (DW4).
    key: "noy",
    fullName: "נוי חזן",
    joins: false,
    expiredLink: true,
    purchases: [{ product: "single", event: "U5", paid: { daysAgo: 3 } }],
  },
  {
    // Took part about four months ago and nothing since: inactive.
    key: "dorit",
    fullName: "דורית לנדאו",
    email: "dorit.landau",
    phone: "03-0000213",
    photoConsent: true,
    personalPhotoConsent: false,
    dietaryNotes: null,
    babies: [{ name: "שירה", ageDays: 280 }],
    purchases: [{ product: "single", event: "H0", paid: { beforeEvent: 5 } }],
  },
  {
    // Nothing open: the live removal of personal details.
    key: "liraz",
    fullName: "לירז קפלן",
    email: "liraz.kaplan",
    phone: "03-0000214",
    photoConsent: false,
    personalPhotoConsent: false,
    dietaryNotes: null,
    babies: [{ name: "עידו", ageDays: 104 }],
    purchases: [{ product: "single", event: "H4", paid: { beforeEvent: 2 } }],
  },
  {
    key: "yifat",
    fullName: "יפעת מור",
    email: "yifat.mor",
    phone: "03-0000215",
    photoConsent: true,
    personalPhotoConsent: true,
    dietaryNotes: null,
    babies: [{ name: "אריה", ageDays: 170 }],
    purchases: [
      { product: "couple", event: "HF", paid: { beforeEvent: 6 } },
      { product: "couple", event: "F1", paid: { daysAgo: 3 } },
    ],
  },
  {
    key: "karin",
    fullName: "קרין סלע",
    email: "karin.sela",
    phone: "03-0000216",
    photoConsent: true,
    personalPhotoConsent: false,
    dietaryNotes: null,
    babies: [{ name: "נוגה", ageDays: 125 }],
    purchases: [{ product: "couple", event: "F2", paid: { daysAgo: 2 } }],
  },
  {
    key: "einav",
    fullName: "עינב דהרי",
    email: "einav.dahari",
    phone: "03-0000217",
    photoConsent: false,
    personalPhotoConsent: true,
    dietaryNotes: null,
    babies: [{ name: "אופיר", ageDays: 149 }],
    purchases: [{ product: "couple", event: "HF", paid: { beforeEvent: 4 } }],
  },
  {
    // A card used up in H1–H4; waits for U2 (a repeat purchase is live).
    key: "stav",
    fullName: "סתיו בכר",
    email: "stav.bachar",
    phone: "03-0000218",
    photoConsent: true,
    personalPhotoConsent: true,
    dietaryNotes: null,
    babies: [{ name: "גפן", ageDays: 201 }],
    purchases: [{ product: "card", paid: { historyWeek: 0 } }],
  },
  // Card holders who fill the sessions and the history. Each pays before
  // her first history session: H1 is at least a day after its Sunday, H2
  // four, H3 eight, H4 eleven; H1's Sunday is at least 12 days back.
  ...[
    ["efrat", "אפרת גולדברג", "efrat.goldberg", { historyWeek: 0 }, "עמית", 110],
    ["lior", "ליאור אברמוב", "lior.abramov", { historyWeek: 0 }, "תמרה", 95],
    ["sharon", "שרון קליין", "sharon.klein", { historyWeek: 0 }, "נדב", 134],
    ["merav", "מירב סגל", "merav.segal", { historyWeek: 1 }, "יעלי", 82],
    ["anat", "ענת רביבו", "anat.revivo", { historyWeek: 2 }, "אוריין", 167],
    ["noga", "נגה שטרן", "noga.stern", { historyWeek: 3 }, "בארי", 121],
    ["rinat", "רינת אוחיון", "rinat.ohayon", { historyWeek: 5 }, "הדס", 73],
    ["dikla", "דקלה פישר", "dikla.fisher", { historyWeek: 6 }, "יהלי", 140],
    ["yaara", "יערה בן דוד", "yaara.bendavid", { daysAgo: 9 }, "אביב", 66],
    ["osnat", "אסנת וקנין", "osnat.vaknin", { daysAgo: 7 }, "מעיין", 152],
    ["shaked", "שקד אילוז", "shaked.elouz", { daysAgo: 12 }, "צור", 101],
    ["hodaya", "הודיה מלמד", "hodaya.melamed", { daysAgo: 3 }, "אלון", 58],
  ].map(([key, fullName, email, paid, baby, ageDays], index) => ({
    key,
    fullName,
    email,
    phone: `03-00002${String(21 + index).padStart(2, "0")}`,
    photoConsent: index % 3 !== 1,
    personalPhotoConsent: index % 2 === 0,
    dietaryNotes:
      key === "rinat"
        ? "צליאקית, בלי גלוטן"
        : key === "osnat"
          ? "אלרגיה לשומשום"
          : null,
    // One of them has twins.
    babies:
      key === "noga"
        ? [
            { name: baby, ageDays },
            { name: "שחר", ageDays },
          ]
        : [{ name: baby, ageDays }],
    purchases: [{ product: "card", paid }],
  })),
]

// Card bookings Tal makes (admin_book_customer), history ones on the
// temporary dates (DW2).
export const ADMIN_BOOKINGS = [
  ["michal", "H2"],
  ["michal", "U1"],
  ["orit", "H1"],
  ["orit", "H3"],
  ["stav", "H1"],
  ["stav", "H2"],
  ["stav", "H3"],
  ["stav", "H4"],
  ...["efrat", "lior", "sharon", "merav", "anat", "noga", "rinat", "dikla"]
    .flatMap((who) => [
      [who, "U2"],
      [who, "U4"],
    ]),
  ["yaara", "U2"],
  ["osnat", "U2"],
  ["shaked", "U2"],
  ["efrat", "H1"],
  ["efrat", "H3"],
  ["lior", "H1"],
  ["lior", "H3"],
  ["sharon", "H1"],
  ["sharon", "H4"],
  ["merav", "H2"],
  ["merav", "H3"],
  ["anat", "H2"],
  ["anat", "H4"],
  ["noga", "H2"],
  ["noga", "H4"],
  ["rinat", "U1"],
  ["rinat", "H3"],
  ["dikla", "U1"],
  ["dikla", "H4"],
  ["yaara", "U1"],
  ["yaara", "U6"],
  ["osnat", "U1"],
  ["osnat", "U6"],
  ["shaked", "U1"],
  ["shaked", "U6"],
  ["hodaya", "U1"],
  ["hodaya", "U3"],
  ["hodaya", "U6"],
  ["hodaya", "U7"],
]

// Michal books U4 herself with her card (book_sessions); one entry stays
// free.
export const SELF_BOOKINGS = [{ who: "michal", events: ["U4"] }]

// Self cancellations of single entries (cancel_booking): a credit with its
// alternatives, or a refund request.
export const SELF_CANCELS = [
  { who: "adi", event: "U4", choice: "credit" },
  { who: "reut", event: "U6", choice: "refund" },
  { who: "yarden", event: "U7", choice: "refund" },
]

// Tal completes this refund (refunded on the run day).
export const COMPLETED_REFUNDS = ["yarden"]

// U2 is full: these wait for it (join_waitlist).
export const WAITLIST = [
  { who: "michal", event: "U2" },
  { who: "stav", event: "U2" },
]

// The business cancels U3 (admin_cancel_event): Sivan's single becomes a
// pending choice; the card entry returns to its card.
export const BUSINESS_CANCEL = "U3"

// Yifat's companion note on her F1 couple booking (set_booking_guest_details).
export const COMPANION_NOTE = {
  who: "yifat",
  event: "F1",
  text: "צמחוני, בלי פטריות",
}

// Moran buys a card as a "new" customer; on its link she types her own email
// and Michal's phone three times (attempts 1 and 2 let her check her
// details; the third turns the link to conflict, two_accounts).
export const CONFLICT = {
  customer: "moran",
  phoneOf: "michal",
  product: "card",
  paid: { daysAgo: 1 },
  attempts: 3,
}

// Internal notes on customer cards.
export const CUSTOMER_NOTES = [
  {
    who: "michal",
    body: "מעדיפה מקום ליד החלון, התינוקת נרדמת רק בעגלה",
  },
  {
    who: "hila",
    body: "הגיעה בהמלצה של מיכל. לשאול אחרי המפגש הראשון איך היה לה",
  },
  {
    who: "yifat",
    body: "בן הזוג מגיע איתה. לשמור להם מקום ליד פינת ההחתלה",
  },
]

// The board (D10): next to the user's own notes.
export const BOARD_NOTES = [
  { body: "להזמין פרחים לשולחן של יום חמישי", pinned: true },
  { body: "לבדוק מחיר של עוד שני כיסאות האכלה" },
  { body: "להחזיר לספק את המגשים הגדולים", done: true },
  { body: "רעיון: בראנץ׳ עם סבתות לקראת החג", archived: true },
]

// The work sheet of U1: an extra prep day (-2), dishes with tasks on each
// prep day, part done; shopping, part bought.
export const WORK_SHEET = {
  event: "U1",
  extraPrepDay: -2,
  dishes: [
    {
      name: "פשטידת תרד וגבינות",
      tasks: [
        { day: -2, body: "להפשיר את בצק העלים", done: true },
        { day: -1, body: "לקצוץ תרד ולערבב את המילוי", done: true },
        { day: 0, body: "לאפות 40 דקות לפני ההגעה", done: false },
      ],
    },
    {
      name: "סלט קינואה עם רימונים",
      tasks: [
        { day: -1, body: "לבשל קינואה ולקרר", done: true },
        { day: 0, body: "לפרק רימון ולתבל רגע לפני ההגשה", done: false },
      ],
    },
    {
      name: "לחמניות מחמצת",
      tasks: [
        { day: -2, body: "להאכיל את המחמצת", done: true },
        { day: -1, body: "ללוש ולהשאיר לתפיחה במקרר", done: false },
        { day: 0, body: "לאפות בבוקר", done: false },
      ],
    },
    {
      name: "עוגת שמרים",
      tasks: [
        { day: -1, body: "להכין בצק ולמלא", done: false },
        { day: 0, body: "לפרוס ולסדר על מגש", done: false },
      ],
    },
  ],
  shopping: [
    { body: "2 חבילות תרד", bought: true },
    { body: "גבינה בולגרית", bought: true },
    { body: "בצק עלים", bought: true },
    { body: "קינואה", bought: true },
    { body: "3 רימונים", bought: false },
    { body: "קמח לחם", bought: true },
    { body: "שמרים יבשים", bought: false },
    { body: "שוקולד מריר", bought: false },
    { body: "חלב שקדים", bought: false },
    { body: "פרחים לשולחן", bought: false },
  ],
}

// The emails whose password is VIDEO_LOGIN_PASSWORD: the filming admin and
// the customer logins (dev-reset-link refuses them).
export const FILMING_LOGIN_EMAILS = [
  FILMING_ADMIN_EMAIL,
  ...LOGINS.map(
    (key) => `${PERSONAS.find((p) => p.key === key).email}@video.example.com`
  ),
]

// The whole cast, as checkCast (scripts/video-cast-rules.mjs) reads it.
export const CAST = {
  sessions: SESSIONS,
  personas: PERSONAS,
  adminBookings: ADMIN_BOOKINGS,
  selfBookings: SELF_BOOKINGS,
  selfCancels: SELF_CANCELS,
  completedRefunds: COMPLETED_REFUNDS,
  waitlist: WAITLIST,
  businessCancel: BUSINESS_CANCEL,
  companionNote: COMPANION_NOTE,
  conflict: CONFLICT,
  customerNotes: CUSTOMER_NOTES,
  boardNotes: BOARD_NOTES,
  workSheet: WORK_SHEET,
  capacity: CAPACITY,
}
