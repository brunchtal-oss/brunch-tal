// Story 5.18: the fictitious business of the demo, as data only. Read by
// scripts/demo-seed.mjs. Every name, phone and note here is invented:
// emails on demo.example.com (a subdomain of a reserved domain) and phones
// 03-0000NNN (a local number starting with 0 that is not allocated in
// Israel). Babies' ages are days before the anchor day.

export { DEMO_DOMAIN } from "./dev-guard.mjs"

// Products are found by type, concepts by theme_key (never by name).
// E0 is today (see demo-plan.mjs); the rest are SESSION_OFFSETS. The
// capacity is explicit (12 regular, 14 couple, today's defaults), so "10 of
// 12" on E5 does not depend on an editable setting.
export const SESSIONS = {
  E0: { theme: "mothers", capacity: 12 },
  E1: { theme: "mothers", capacity: 12 },
  E2: { theme: "greek", capacity: 12 },
  E3: { theme: "couples", capacity: 14 },
  E4: { theme: "greek", capacity: 12 },
  E5: { theme: "mothers", capacity: 12 },
  E6: { theme: "mothers", capacity: 12 },
  E7: { theme: "grandma", capacity: 14 },
}

// join: the purchase that comes with the join link (a new customer).
// Later purchases are for an existing customer. paidDaysAgo: paid_on before
// the anchor day; "expiring" = the card that ends on D+9.
export const CUSTOMERS = [
  {
    key: "maya",
    fullName: "מאיה ברק",
    email: "maya.barak",
    phone: "03-0000101",
    photoConsent: true,
    personalPhotoConsent: true,
    dietaryNotes: null,
    babies: [{ name: "אורי", ageDays: 124 }],
    purchases: [
      { product: "card", paidDaysAgo: 0 },
      { product: "single", event: "E4", paidDaysAgo: 0 },
    ],
  },
  {
    key: "noa",
    fullName: "נועה אברהם",
    email: "noa.avraham",
    phone: "03-0000102",
    photoConsent: true,
    personalPhotoConsent: false,
    dietaryNotes: "צמחונית, בלי דגים",
    babies: [{ name: "מיה", ageDays: 171 }],
    purchases: [{ product: "card", paidDaysAgo: "expiring" }],
  },
  {
    // Paid for E2 and never joined: "waiting to join" on the session.
    key: "sapir",
    fullName: "ספיר רבינוביץ",
    joins: false,
    purchases: [{ product: "single", event: "E2", paidDaysAgo: 1 }],
  },
  {
    key: "keren",
    fullName: "קרן וייס",
    email: "keren.weiss",
    phone: "03-0000104",
    photoConsent: false,
    personalPhotoConsent: false,
    dietaryNotes: null,
    babies: [{ name: "איתי", ageDays: 96 }],
    purchases: [{ product: "single", event: "E5", paidDaysAgo: 2 }],
  },
  {
    key: "shira",
    fullName: "שירה כהן",
    email: "shira.cohen",
    phone: "03-0000105",
    photoConsent: true,
    personalPhotoConsent: true,
    dietaryNotes: "אלרגיה לאגוזים ולבוטנים",
    babies: [{ name: "נועם", ageDays: 63 }],
    purchases: [{ product: "intro", event: "E1", paidDaysAgo: 0 }],
  },
  {
    key: "hadar",
    fullName: "הדר מזרחי",
    email: "hadar.mizrahi",
    phone: "03-0000106",
    photoConsent: true,
    personalPhotoConsent: false,
    dietaryNotes: null,
    babies: [{ name: "תמר", ageDays: 108 }],
    purchases: [{ product: "intro", event: "E5", paidDaysAgo: 1 }],
  },
  {
    key: "liat",
    fullName: "ליאת פרץ",
    email: "liat.peretz",
    phone: "03-0000107",
    photoConsent: false,
    personalPhotoConsent: false,
    dietaryNotes: null,
    babies: [{ name: "יונתן", ageDays: 130 }],
    purchases: [{ product: "couple", event: "E3", paidDaysAgo: 3 }],
  },
  {
    key: "yael",
    fullName: "יעל לוי",
    email: "yael.levi",
    phone: "03-0000108",
    photoConsent: true,
    personalPhotoConsent: true,
    dietaryNotes: "צליאקית, בלי גלוטן בכלל",
    babies: [
      { name: "אלה", ageDays: 88 },
      { name: "ליה", ageDays: 88 },
    ],
    purchases: [{ product: "card", paidDaysAgo: 10 }],
  },
  {
    key: "roni",
    fullName: "רוני גולן",
    email: "roni.golan",
    phone: "03-0000109",
    photoConsent: true,
    personalPhotoConsent: true,
    dietaryNotes: null,
    babies: [{ name: "אריאל", ageDays: 152 }],
    purchases: [{ product: "card", paidDaysAgo: 5 }],
  },
  {
    key: "tamar",
    fullName: "תמר שפירא",
    email: "tamar.shapira",
    phone: "03-0000110",
    photoConsent: false,
    personalPhotoConsent: true,
    dietaryNotes: "טבעונית",
    babies: [{ name: "עומר", ageDays: 117 }],
    purchases: [{ product: "card", paidDaysAgo: 3 }],
  },
  {
    key: "avigail",
    fullName: "אביגיל דהן",
    email: "avigail.dahan",
    phone: "03-0000111",
    photoConsent: true,
    personalPhotoConsent: true,
    dietaryNotes: null,
    babies: [{ name: "הלל", ageDays: 79 }],
    purchases: [{ product: "single", event: "E5", paidDaysAgo: 4 }],
  },
  {
    key: "inbal",
    fullName: "ענבל חדד",
    email: "inbal.hadad",
    phone: "03-0000112",
    photoConsent: true,
    personalPhotoConsent: false,
    dietaryNotes: null,
    babies: [{ name: "שקד", ageDays: 141 }],
    purchases: [{ product: "single", event: "E5", paidDaysAgo: 2 }],
  },
  {
    key: "or",
    fullName: "אור ביטון",
    email: "or.biton",
    phone: "03-0000113",
    photoConsent: true,
    personalPhotoConsent: true,
    dietaryNotes: null,
    babies: [{ name: "רומי", ageDays: 160 }],
    purchases: [{ product: "card", paidDaysAgo: 14 }],
  },
  {
    key: "dana",
    fullName: "דנה אזולאי",
    email: "dana.azulay",
    phone: "03-0000114",
    photoConsent: false,
    personalPhotoConsent: false,
    dietaryNotes: null,
    babies: [{ name: "דניאל", ageDays: 101 }],
    purchases: [{ product: "single", event: "E5", paidDaysAgo: 1 }],
  },
  {
    key: "rotem",
    fullName: "רותם פרידמן",
    email: "rotem.friedman",
    phone: "03-0000115",
    photoConsent: true,
    personalPhotoConsent: true,
    dietaryNotes: null,
    babies: [{ name: "גיא", ageDays: 70 }],
    purchases: [{ product: "single", event: "E1", paidDaysAgo: 0 }],
  },
]

// The customer who is the demo login.
export const LOGIN_CUSTOMER = "maya"

// Keren's second purchase, approved as a new customer: on its link she types
// her own email and another customer's phone, three times (attempts 1 and 2
// let her check her details; the third turns the link to conflict,
// two_accounts), so it shows in Tal's "to handle".
export const CONFLICT = {
  customer: "keren",
  product: "card",
  paidDaysAgo: 0,
  phoneOf: "maya",
  attempts: 3,
}

// Card bookings Tal makes (admin_book_customer). The E0 ones run right after
// that customer's join, while E0 is still running; the rest after all joins.
export const ADMIN_BOOKINGS = [
  ["maya", "E0"],
  ["yael", "E0"],
  ["roni", "E0"],
  ["tamar", "E0"],
  ["roni", "E1"],
  ["or", "E2"],
  ["noa", "E5"],
  ["yael", "E5"],
  ["roni", "E5"],
  ["tamar", "E5"],
  ["or", "E5"],
  ["tamar", "E6"],
]

// Maya books these herself with her card (book_sessions), one entry stays
// free; then she cancels her single entry for E4 (cancel_booking).
export const SELF_BOOKINGS = { customer: "maya", events: ["E2", "E6"] }
export const SELF_CANCEL = { customer: "maya", event: "E4" }

// Tal's internal notes on customer cards.
export const NOTES = [
  {
    customer: "maya",
    body: "מעדיפה לשבת ליד החלון, אורי נרדם רק בעגלה",
  },
  {
    customer: "hadar",
    body: "הגיעה בהמלצה של יעל. לשאול אחרי המפגש הראשון איך היה לה",
  },
  {
    customer: "liat",
    body: "בן הזוג מגיע איתה. לשמור להם מקום ליד פינת ההחתלה",
  },
]

// The work sheet of E5: dishes with tasks on the day before (-1) and on the
// day (0); done marks part of them.
export const WORK_SHEET = {
  event: "E5",
  dishes: [
    {
      name: "שקשוקה ירוקה",
      tasks: [
        { day: -1, body: "לשטוף ולקצוץ תרד ובצל ירוק", done: true },
        { day: 0, body: "לבשל במחבת הגדולה ולהוסיף ביצים", done: false },
      ],
    },
    {
      name: "פוקאצ׳ה עם רוזמרין",
      tasks: [
        { day: -1, body: "להכין בצק ולהשאיר לתפוח במקרר", done: true },
        { day: 0, body: "לאפות שעה לפני ההגעה", done: false },
      ],
    },
    {
      name: "סלט כרוב סגול עם בוטנים",
      tasks: [
        { day: -1, body: "לקלות את הבוטנים", done: true },
        { day: 0, body: "לפרוס כרוב ולתבל רגע לפני ההגשה", done: false },
      ],
    },
    {
      name: "עוגת תפוזים",
      tasks: [
        { day: -1, body: "לאפות את העוגה", done: false },
        { day: 0, body: "לפזר אבקת סוכר ולפרוס", done: false },
      ],
    },
  ],
  shopping: [
    { body: "30 ביצים", bought: true },
    { body: "2 חבילות תרד", bought: true },
    { body: "צרור בצל ירוק", bought: true },
    { body: "קמח לבן", bought: true },
    { body: "רוזמרין", bought: false },
    { body: "כרוב סגול", bought: false },
    { body: "בוטנים קלויים", bought: false },
    { body: "6 תפוזים", bought: false },
  ],
}
