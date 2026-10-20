import type { ErrorCode } from "@/lib/errors"

// System microcopy of the admin screens. Amounts arrive formatted by
// lib/money.ts ("472 ₪"), dates by lib/time.ts.

// The customers export's column headers (story 4.4): the file's header row
// and the audit log's "columns" values.
const exportHeaders = {
  full_name: "שם",
  phone: "טלפון",
  email: "מייל",
}

export const adminCopy = {
  // The two photo consents (story 2.13, user decision 2026-10-07): a line
  // each on the customer card and the session's registrant row, and a short
  // mark each on the work sheet ("אווירה ✗ · אישיות ✓", the label in full
  // words for a screen reader).
  photoConsents: {
    atmosphere: {
      yes: "אישרה תמונות אווירה",
      no: "לא אישרה תמונות אווירה",
      short: "אווירה",
      // The registrant row: "תמונות אווירה ✓ - תמונות אישיות ✗".
      label: "תמונות אווירה",
    },
    personal: {
      yes: "אישרה תמונות אישיות",
      no: "לא אישרה תמונות אישיות",
      short: "אישיות",
      label: "תמונות אישיות",
    },
    yesMark: "✓",
    noMark: "✗",
    separator: " · ",
    rowSeparator: " - ",
  },
  payments: {
    newTitle: "הוספת תשלום",
    newCustomer: "לקוחה חדשה",
    product: "מוצר",
    amount: "סכום ששולם",
    amountFromProduct: (amount: string) => `מהמוצר: ${amount}`,
    paidOn: "תאריך רכישה",
    method: "אמצעי תשלום",
    more: "פרטים נוספים (לא חובה)",
    reference: "אסמכתה (לא חובה)",
    note: "הערה (לא חובה)",
    preview: "מה ייווצר",
    previewUnits: (product: string, units: number) =>
      `${product} · ${units} כניסות`,
    previewExpires: "בתוקף עד",
    previewLink: "אחרי האישור ייווצר קישור הצטרפות חד-פעמי (48 שעות)",
    submit: "אישור תשלום ויצירת קישור",
    success: "התשלום אושר. הקישור מוכן לשליחה",
    // A repeat with the same key: the raw link is returned only once (AD-10).
    linkNotShown:
      "התשלום כבר אושר, ואת הקישור אי אפשר להציג שוב. קישור חלופי, בלי תשלום נוסף, יתאפשר במסך הקישורים",
    linkTitle: "לקוחה חדשה · הקישור מחכה להצטרפות",
    // With a payer label (story 2.5, user decision 2026-10-04).
    linkTitleNamed: (label: string) => `${label} · הקישור מחכה להצטרפות`,
    linkPending: "ממתין למימוש",
    linkValidUntil: "תקף עד",
    linkOnce: "לשימוש פעם אחת. פתיחה לא צורכת אותו",
    sendWhatsapp: "שליחה בוואטסאפ",
    copyLink: "העתקת הקישור",
    copied: "הקישור הועתק",
    another: "להוספת תשלום נוסף",
    // The link at the top of "add payment" to the links screen.
    allLinks: "לכל קישורי ההצטרפות",
    // Story 2.5 (wording approved by the user on 2026-10-04).
    // /admin/payments/new: whom the payment is for.
    choiceLegend: "למי התשלום?",
    // A new customer only: a name only Tal sees, until the customer joins.
    payerLabel: "שם לזיהוי",
    payerLabelHint: "רק את רואה אותו",
    existingCustomer: "לקוחה קיימת",
    // /admin/payments/new/existing
    searchLabel: "חיפוש לפי שם או טלפון",
    searchHint: "לפחות 2 תווים",
    searchResult: (name: string, phone: string) =>
      phone ? `${name} · ${phone}` : name,
    searchNone: "לא נמצאה לקוחה. אפשר לחפש לפי חלק מהשם או לפי מספר הטלפון",
    // The head of the form for an existing customer, and its button.
    customerHead: (name: string, phone: string) =>
      phone ? `${name} · ${phone}` : name,
    changeCustomer: "החלפה",
    // The amount field: from the product, or changed.
    amountChanged: (price: string) => `מחיר הקטלוג: ${price} · הסכום שונה`,
    amountInvalid: "סכום לא תקין",
    overrideReason: "סיבת שינוי המחיר (לא חובה)",
    previewForCustomer: (name: string) => `הרכישה תתווסף לחשבון של ${name}`,
    // The expiry of the purchase is already in the past (new or existing).
    previewExpired: "תאריך התפוגה כבר עבר. הרכישה תופיע אצל הלקוחה כפגה",
    duplicateTitle: "נמצא תשלום דומה",
    duplicateBody: (days: number) =>
      `אותו מוצר, סכום ואמצעי תשלום, בטווח של ${days} ימים מתאריך הרכישה:`,
    duplicateRow: (name: string, paidOn: string, approvedOn: string) =>
      `${name} · רכישה ${paidOn} · אושר ${approvedOn}`,
    duplicateConfirm: "בדקתי, וזה תשלום נפרד ולא כפילות",
    submitExisting: "לאישור התשלום",
    successExisting: (name: string) =>
      `התשלום אושר. הרכישה נוספה לחשבון של ${name}`,
    successPurchase: (product: string, units: number, expiresOn: string) =>
      `${product} · ${units} כניסות · בתוקף עד ${expiresOn}`,
    toList: "לרשימת התשלומים",
    // After approving a pinned product (story 3.11, wording approved by the
    // user; two lines, no time, 2026-10-05). day: "{יום} DD.MM".
    successPlacedLead: (product: string) => `${product} · המקום נשמר:`,
    successPlacedSession: (concept: string, day: string) =>
      `בראנץ׳ ${concept} · ${day}`,
    // A pinned product's session (story 3.11, wording from the spec's design
    // notes): a radio row of two lines, no time (user decision 2026-10-05).
    // day: "{יום} DD.MM".
    event: "מפגש",
    eventPlaceholder: "בחרי מפגש",
    eventOptionTitle: (concept: string) => `בראנץ׳ ${concept}`,
    eventOptionDetails: (
      day: string,
      occupied: number,
      capacity: number,
      full: boolean
    ) => `${day} · ${occupied}/${capacity}${full ? " · מלא" : ""}`,
    eventNone: "אין מפגש פתוח שמתאים למוצר הזה",
    previewEvent: (concept: string, day: string) =>
      `מפגש: בראנץ׳ ${concept} · ${day}`,
    // The price_change dialog (lib/admin/sensitive-actions.ts has its title).
    priceChange: {
      body: "הסכום שונה ממחיר הקטלוג. בדקי לפני האישור.",
      customer: "לקוחה",
      newCustomer: "לקוחה חדשה (תמלא פרטים בקישור)",
      product: "מוצר",
      price: "מחיר",
      reason: "סיבה",
      priceChange: (price: string, amount: string) => `${price} ← ${amount}`,
      confirm: (amount: string, price: string) =>
        `אני מאשרת שהלקוחה משלמת ${amount} במקום מחיר הקטלוג ${price}, ושהשינוי יירשם ביומן הפעולות`,
    },
  },
  // /admin/payments (story 2.5, wording approved by the user on 2026-10-04).
  paymentsList: {
    title: "תשלומים",
    add: "הוספת תשלום",
    unbound: "לקוחה חדשה · עוד לא הצטרפה",
    unboundNamed: (label: string) => `${label} · עוד לא הצטרפה`,
    // "{product} · {amount} · {method} · רכישה {DD.MM} · אושר {DD.MM}"
    details: (
      product: string,
      amount: string,
      method: string,
      paidOn: string,
      approvedOn: string
    ) =>
      `${product} · ${amount} · ${method} · רכישה ${paidOn} · אושר ${approvedOn}`,
    catalogPrice: (price: string) => `מחיר הקטלוג ${price}`,
    reason: (reason: string) => `סיבה: ${reason}`,
    reference: (value: string) => `אסמכתה: ${value}`,
    note: (value: string) => `הערה: ${value}`,
    limit: "מוצגים 50 התשלומים האחרונים",
    empty: "אין עדיין תשלומים",
  },
  // The refunds section of /admin/payments (story 3.9, user decisions
  // 2026-10-14): the open requests, then the completed refunds of purchases
  // not bound yet (they have no customer card); a bound one's completed
  // refund is in her card. The dialog's title is in
  // lib/admin/sensitive-actions.ts (refund_complete).
  refunds: {
    title: "בקשות החזר",
    // "{customer} · בראנץ׳ {concept} {DD.MM}"
    rowTitle: (customer: string, concept: string, day: string) =>
      `${customer} · בראנץ׳ ${concept} ${day}`,
    // An open request: "בקשת החזר של {amount} · {product}"
    requested: (amount: string, product: string) =>
      `בקשת החזר של ${amount} · ${product}`,
    // A completed one: "הוחזר {amount} ב-{DD.MM.YY}"
    completed: (amount: string, date: string) => `הוחזר ${amount} ב-${date}`,
    reference: (value: string) => `אסמכתה: ${value}`,
    chipOpen: "בקשת החזר",
    chipDone: "הוחזר",
    // The small heading of the completed refunds of unbound purchases.
    unboundDone: "החזרים ללקוחות שעוד לא הצטרפו",
    button: "סימון שההחזר בוצע",
    buttonLabel: (name: string) => `סימון שההחזר של ${name} בוצע`,
    // The dialog.
    description:
      "ההחזר יירשם כבוצע, והזיכוי ייסגר. הלקוחה תקבל הודעה שההחזר הועבר אליה.",
    descriptionNoCustomer:
      "ההחזר יירשם כבוצע, והזיכוי ייסגר. הלקוחה תראה אותו כשתצטרף.",
    customer: "לקוחה",
    session: "מפגש",
    paid: "שולם",
    refundedBefore: "הוחזר כבר מהתשלום הזה",
    max: "אפשר להחזיר עד",
    dateLabel: "תאריך ההחזר",
    amountLabel: "סכום ההחזר",
    referenceLabel: "אסמכתה (לא חובה)",
    // The confirm pressed with a field that is not valid.
    dateMissing: "צריך לבחור את תאריך ההחזר",
    amountInvalid: "צריך להזין סכום תקין, למשל 180",
    amountTooHigh: (max: string) => `אפשר להחזיר עד ${max}`,
    // INVALID_INPUT of the action, by detail.field.
    dateInvalid: "התאריך צריך להיות בין יום התשלום להיום",
    referenceTooLong: "האסמכתה ארוכה מדי. אפשר עד 200 תווים",
    // amount: "" while the field is not a valid sum.
    checkbox: (amount: string, name: string) =>
      amount === ""
        ? `אני מאשרת שההחזר הועבר ל${name}, ושהוא יירשם ביומן הפעולות`
        : `אני מאשרת שהחזר של ${amount} הועבר ל${name}, ושהוא יירשם ביומן הפעולות`,
    confirm: "לאישור ההחזר",
    done: "ההחזר נרשם",
  },
  // /admin/content (story 5.1): the content editor. Draft -> preview ->
  // publish (EXPERIENCE › admin states › site content).
  content: {
    title: "תוכן האתר",
    // The editor's pages, grouped by where they are on the site (story 5.3).
    pages: {
      home: "בית",
      "how-it-works": "איך זה עובד",
      gallery: "גלריה והמלצות",
      contact: "יצירת קשר",
      "join-form": "טופס ההצטרפות",
      site: "פוטר",
      // Story 5.5: the legal pages.
      privacy: "מדיניות פרטיות",
      terms: "תנאי שימוש",
      accessibility: "הצהרת נגישות",
    },
    // The sections, by "slug/key".
    sections: {
      "home/hero": "הירו",
      "home/intro": "פתיח",
      "about/main": "אודות",
      "home/contact": "יצירת קשר",
      "how-it-works/steps": "שלבים",
      "how-it-works/faq": "שאלות נפוצות",
      "gallery/photos": "גלריה",
      "gallery/testimonials": "המלצות",
      "contact/intro": "פתיח",
      "contact/business_details": "פרטי העסק",
      "join-form/photo_consent": "בקשת אישור התמונות",
      "site/footer": "קישורים",
      "privacy/body": "נוסח המדיניות",
      "terms/body": "נוסח התנאים",
      "accessibility/statement": "נוסח ההצהרה",
    } as Record<string, string>,
    // The row of "site" that leads to the business details (the footer's
    // phone and address come from there).
    footerDetails: {
      title: "טלפון וכתובת",
      detail: "נערכים בפרטי העסק",
    },
    // The testimonials are also shown on the home page.
    alsoOnHome: "מוצג גם בדף הבית",
    // content-section-row chips (DESIGN › content-section-row).
    status: {
      draft: "טיוטה",
      published: "פורסם",
      changed: "שינויים שלא פורסמו",
      hidden: "מוסתר",
    },
    notShown: "לא מוצג באתר עד שיפורסם",
    changedHint: "יש טיוטה שעוד לא פורסמה",
    publishedHint: "התוכן מופיע באתר",
    backToList: "לכל התוכן",
    backToPage: (page: string) => `חזרה ל${page}`,
    saveDraft: "שמירת טיוטה",
    publish: "פרסום",
    preview: "תצוגה מקדימה",
    saved: "הטיוטה נשמרה. היא לא תוצג באתר עד הפרסום",
    published: "פורסם. האתר יציג את השינוי בטעינה הבאה",
    nothingToPublish: "לא בוצעו שינויים לפרסום",
    // A preview of more than one slug (home and about) whose publish stopped
    // after some of them were published.
    partlyPublished: (error: string) =>
      `חלק מהשינויים פורסמו, והשאר עוד לא. ${error}`,
    // A field the saved draft or the form refused (zod, lib/content/schema.ts).
    fieldError: {
      required: "צריך למלא את השדה הזה",
      tooLong: (max: number) => `עד ${max} תווים`,
      phone: "מספר טלפון לא תקין",
      url: "קישור לא תקין. צריך להתחיל ב-https://",
      email: "כתובת מייל לא תקינה",
      invalid: "הערך לא תקין",
    },
    // A saved draft that does not pass the schema (edited elsewhere).
    draftInvalid: "בטיוטה השמורה יש שדה לא תקין. כדאי לתקן ולשמור שוב",
    hero: {
      title: "כותרת (לא חובה)",
      description: "תיאור (לא חובה)",
    },
    // text_block (story 5.3). Since 2026-10-08 only three fields are
    // required (the statement's, the photo consents, the WhatsApp
    // number); every other label says "(לא חובה)".
    textBlock: {
      eyebrow: "שורה קטנה מעל הכותרת (לא חובה)",
      title: "כותרת (לא חובה)",
      body: "טקסט",
      bodyOptional: "טקסט (לא חובה)",
    },
    // The title of a list section (steps, faq, testimonials).
    listTitle: "כותרת הסקשן (לא חובה)",
    steps: {
      item: (n: number) => `שלב ${n}`,
      add: "הוספת שלב",
      title: "שם השלב (לא חובה)",
      body: "הסבר (לא חובה)",
    },
    faq: {
      item: (n: number) => `שאלה ${n}`,
      add: "הוספת שאלה",
      question: "שאלה (לא חובה)",
      answer: "תשובה (לא חובה)",
    },
    testimonials: {
      item: (n: number) => `המלצה ${n}`,
      add: "הוספת המלצה",
      name: "שם לתצוגה (לא חובה)",
      text: "טקסט ההמלצה (לא חובה)",
      // Story 5.4: a testimonial is text or an image (a screenshot).
      kind: "סוג ההמלצה",
      kinds: { text: "טקסט", image: "תמונה" },
      image: "צילום ההמלצה",
      imageHint: "צילום מסך שכבר הוסתרו בו השם והטלפון",
      imageName: "שם לתצוגה (לא חובה)",
      altHint: "מומלץ: תמלול קצר של ההמלצה, בשביל מי שלא רואה את התמונה",
    },
    // gallery › photos (story 5.4).
    gallery: {
      item: (n: number) => `תמונה ${n}`,
      add: "הוספת תמונה",
      image: "תמונה",
      caption: "כיתוב (לא חובה)",
      // The columns of the gallery on the phone (user decision 2026-10-08).
      columns: "מספר עמודות",
    },
    // The image of a block (hero, about).
    blockImage: "תמונה (לא חובה)",
    heroImageHint: "מוצגת מאחורי הכותרת, בגובה המסך",
    footerLinks: {
      item: (n: number) => `קישור ${n}`,
      add: "הוספת קישור",
      label: "שם לתצוגה (לא חובה)",
      labelHint: "למשל: אינסטגרם",
      url: "כתובת (לא חובה)",
      urlHint: "מתחילה ב-https://. הקישור ייפתח בחלון חדש",
    },
    // A section of a legal text (story 5.5): privacy, terms and the
    // statement's extra sections.
    legal: {
      body: "הנוסח המלא (לא חובה)",
      // The formatting of components/public/legal-text.tsx (user decision
      // 2026-10-06: one field, pasted whole).
      hint: 'אפשר להדביק את כל הנוסח, בלי הכותרת הראשית ובלי תאריך העדכון: הם מוצגים אוטומטית. שורה ריקה מתחילה פסקה חדשה. שורה שמתחילה ב-"## " היא כותרת. שורה שמתחילה ב-"- " היא פריט ברשימה. **מודגש**. קישור: [טקסט](https://...), טלפון: [054-0000000](tel:+972540000000), מייל: [טקסט](mailto:...)',
    },
    // accessibility › statement (story 5.5). The fixed headings of the page
    // are in shellCopy.public.legal.accessibility.
    statement: {
      body: "נוסח ההצהרה המלא",
      contactName: "שם איש או אשת הקשר לנגישות",
      contactPhone: "טלפון לנגישות",
      contactEmail: "מייל לנגישות",
      // Before the first publish, while a required field is missing
      // (EXPERIENCE › admin states: publish aria-disabled + the list).
      blocked: "אי אפשר לפרסם את ההצהרה לפני שממלאים את שדות החובה:",
    },
    // Story 2.13: two consents and one note under both.
    photoConsent: {
      atmosphere: {
        title: "כותרת: תמונות אווירה",
        question: "השאלה על תמונות אווירה",
        yes: "תשובת ההסכמה לתמונות אווירה",
        no: "תשובת הסירוב לתמונות אווירה",
      },
      personal: {
        title: "כותרת: תמונות אישיות",
        question: "השאלה על תמונות אישיות",
        yes: "תשובת ההסכמה לתמונות אישיות",
        no: "תשובת הסירוב לתמונות אישיות",
      },
      note: "ההערה שמתחת לשתי השאלות",
      linesHint: "כל שורה תוצג בשורה משלה",
    },
    // A list's items (DESIGN › content-section-row: reorder buttons, hide,
    // delete). The item is named by its first field, else "{type} {n}".
    item: {
      moveUp: (name: string) => `להזיז את ${name} למעלה`,
      moveDown: (name: string) => `להזיז את ${name} למטה`,
      hide: "הסתרה",
      show: "הצגה",
      remove: "מחיקה",
      // Announced (aria-live) after an action on an item.
      moved: (name: string, position: number, total: number) =>
        `הפריט ${name} במקום ${position} מתוך ${total}`,
      hiddenNow: (name: string) => `הפריט ${name} מוסתר`,
      shownNow: (name: string) => `הפריט ${name} מוצג`,
      removed: (name: string) => `הפריט ${name} נמחק`,
      // The inline confirm of a delete (user decision 2026-10-05).
      confirmRemove: (name: string) => `למחוק את ${name}?`,
      cancel: "ביטול",
      added: "נוסף פריט חדש",
    },
    // The gallery's arrange view (user decision 2026-10-08): the photos
    // as on the site, tap one and then its new place.
    arrange: {
      views: "תצוגת העריכה",
      list: "רשימה",
      grid: "סידור",
      hint: "לוחצים על תמונה ואז על תמונה אחרת כדי להחליף ביניהן. השינוי נשמר עם שמירת הטיוטה",
      photo: (n: number) => `תמונה ${n}`,
      hidden: "מוסתרת",
      selected: (n: number) =>
        `תמונה ${n} נבחרה. לוחצים על תמונה אחרת כדי להחליף ביניהן, או עליה שוב לביטול`,
      cancelled: "הבחירה בוטלה",
      swapped: (a: number, b: number) => `תמונות ${a} ו-${b} הוחלפו`,
      before: (n: number) => `להעביר את תמונה ${n} מקום אחד קודם`,
      after: (n: number) => `להעביר את תמונה ${n} מקום אחד אחרי`,
      cancel: "ביטול הבחירה",
      // The bar with nothing selected.
      barHint: "בוחרים תמונה",
      beforeNone: "מקום אחד קודם",
      afterNone: "מקום אחד אחרי",
    },
    itemCount: (n: number) => (n === 1 ? "פריט אחד" : `${n} פריטים`),
    emptyList: "אין פריטים. בלי פריט גלוי הסקשן לא מוצג באתר",
    hiddenItemHint: "מוסתר, לא יוצג באתר",
    // Hiding a whole section (text_block, steps, faq, testimonials).
    hideSection: "הסתרת הסקשן",
    showSection: "הצגת הסקשן",
    sectionHiddenNotice: "הסקשן מוסתר. אחרי הפרסום הוא לא יוצג באתר",
    // Undo in two levels (user decision 2026-10-05).
    undo: {
      // Back to the saved draft, without the server.
      revert: "ביטול השינויים",
      reverted: "השינויים בוטלו. הטופס חזר לטיוטה השמורה",
      // The saved draft becomes what the site shows.
      discard: "חזרה למה שמוצג באתר",
      discardQuestion: "לחזור למה שמוצג באתר?",
      discardDetail:
        "הטיוטה השמורה של הסקשן הזה תימחק, והטופס יחזור לתוכן שמוצג עכשיו באתר",
      discardConfirm: "חזרה למה שמוצג באתר",
      discarded: "הטיוטה נמחקה. הטופס מציג את מה שמוצג באתר",
      cancel: "ביטול",
    },
    business: {
      whatsappPhone: "מספר וואטסאפ",
      whatsappPhoneHint: "אליו מגיעות ההודעות מהאתר",
      businessName: "שם העסק (לא חובה)",
      phone: "טלפון (לא חובה)",
      whatsappMessage: "הודעה מוכנה לוואטסאפ (לא חובה)",
      whatsappMessageHint: "הטקסט שיופיע בהודעה כשלוחצים על וואטסאפ באתר",
      address: "כתובת (לא חובה)",
      arrivalInstructions: "הוראות הגעה (לא חובה)",
      navigationUrl: "קישור ניווט (לא חובה)",
      navigationUrlHint: "למשל קישור מ-Google Maps או Waze, שמתחיל ב-https://",
    },
    // /admin/content/<page>/preview
    previewTitle: "תצוגה מקדימה",
    previewBar: "תצוגה מקדימה — עוד לא פורסם",
    previewNoChanges: "תצוגה מקדימה — כמו שמוצג עכשיו באתר",
    backToEdit: "חזרה לעריכה",
  },
  // image-upload-field (story 5.4; DESIGN › image-upload-field). The alt text
  // is recommended, not required (user decision 2026-10-05).
  image: {
    choose: "בחירת תמונה",
    chooseHint: "JPG, PNG או WEBP. התמונה מוקטנת לפני ההעלאה",
    replace: "החלפת התמונה",
    remove: "הסרת התמונה",
    uploading: "מעלה את התמונה…",
    uploaded: "התמונה הועלתה. היא תוצג באתר אחרי הפרסום",
    retry: "לנסות שוב",
    notSupported: "סוג קובץ לא נתמך. אפשר לבחור JPG, PNG או WEBP",
    tooLarge: "הקובץ גדול מדי. אפשר לבחור תמונה קטנה יותר",
    uploadFailed: "ההעלאה לא הסתיימה",
    unreadable: "לא הצלחנו לקרוא את התמונה. אפשר לבחור תמונה אחרת",
    // A saved image whose file never reached the drafts.
    notUploaded: "ההעלאה לא הסתיימה. אפשר להחליף את התמונה",
    alt: "טקסט חלופי (מומלץ)",
    altHint: "מומלץ: תיאור קצר של מה שרואים בתמונה, בשביל מי שלא רואה אותה",
    // The focus point (DESIGN › image-upload-field: the crop frame).
    focusTitle: "מה חשוב בתמונה",
    focusHint: "נגעי בנקודה החשובה. המסגרת מראה מה ייראה בטלפון",
    focusAt: (x: number, y: number) =>
      `נקודת המוקד: ${x}% מהשמאל, ${y}% מלמעלה`,
    previewAlt: "תצוגה מקדימה של התמונה",
  },
  // /admin/products (story 2.6, wording approved by the user on 2026-10-04).
  products: {
    title: "מוצרים",
    add: "הוספת מוצר",
    hidden: "מוסתר",
    // "{price} · {N} כניסות · בתוקף {N} ימים / מוצמד למפגש"; one entry is
    // "כניסה אחת".
    summary: (price: string, units: number, validity: string) =>
      `${price} · ${units === 1 ? "כניסה אחת" : `${units} כניסות`} · ${validity}`,
    validityDays: (days: number) => `בתוקף ${days} ימים`,
    validitySession: "מוצמד למפגש",
    // The fixed note of the product screens.
    scopeNote: "השינוי חל על רכישות חדשות בלבד. זכויות שכבר ניתנו לא משתנות",
    fields: {
      type: "סוג",
      name: "שם",
      price: "מחיר",
      units: "מספר כניסות",
      validity: "תוקף",
      validityDays: "מספר ימים",
      weekdays: "ימי מימוש",
      eventKind: "סוג מפגש",
      partySize: "מספר מבוגרים",
      introOnly: "להיכרות בלבד",
      postJoinMessage: "הודעה אחרי רכישה (לא חובה)",
      postJoinButtonLabel: "תווית הכפתור (לא חובה)",
    },
    types: {
      single: "בודד",
      intro: "היכרות",
      card: "כרטיסייה",
      couple: "זוגי",
    },
    validityModes: { days: "בימים", session: "מוצמד למפגש" },
    eventKinds: { regular: "רגיל", couple: "זוגי" },
    weekdaysAll: "כל הימים",
    weekdaysOpen: "הגבלה לימים מסוימים",
    weekdaysEmpty: "צריך לבחור לפחות יום אחד",
    // The value of a yes / no field in "old ← new".
    yes: "כן",
    no: "לא",
    // An empty optional text in "old ← new".
    empty: "—",
    hide: "הסתרת המוצר",
    show: "הצגת המוצר",
    state: "מצב",
    stateOffered: "מוצע",
    stateHidden: "מוסתר",
    hideScope: "מוסתר לא מוצע בהוספת תשלום, ותשלומי עבר לא משתנים",
    // The price_change dialog (lib/admin/sensitive-actions.ts has its title).
    priceDialog: {
      product: "מוצר",
      price: "מחיר",
      reason: "סיבה (לא חובה)",
      priceChange: (from: string, to: string) => `${from} ← ${to}`,
      confirm: (name: string, price: string) =>
        `אני מאשרת שהמחיר של ${name} משתנה ל-${price}, ושהשינוי יירשם ביומן הפעולות`,
    },
    create: {
      title: "הוספת מוצר",
      submit: "שמירת המוצר",
    },
  },
  // /admin/concepts (story 4.8, CAP-41).
  concepts: {
    title: "קונספטים",
    add: "קונספט",
    addLabel: "הוספת קונספט",
    empty: "אין עדיין קונספטים",
    archivedChip: "בארכיון",
    showArchive: "להציג ארכיון",
    hideArchive: "להסתיר ארכיון",
    kinds: { regular: "רגיל", couple: "זוגי" },
    fields: {
      name: "שם",
      description: "תיאור (לא חובה)",
      kind: "סוג",
    },
    // The notes under the editor's fields.
    nameNote: "שינוי השם מופיע בכל המפגשים של הקונספט",
    descriptionNote:
      "מפגש חדש מקבל את התיאור הזה, ואפשר לשנות אותו במפגש. בלי תיאור במפגש, יוצג התיאור הזה.",
    kindNote: "שינוי הסוג חל על מפגשים חדשים בלבד",
    nameTooLong: "עד 100 תווים",
    descriptionTooLong: "עד 2000 תווים",
    save: "שמירה",
    saved: "השינויים נשמרו",
    image: {
      label: "תמונה (לא חובה)",
      hint: "מוצגת בכל מפגש בלי תמונה משלו",
      save: "שמירת התמונה",
      saved: "התמונה נשמרה ומוצגת באתר",
      removed: "התמונה הוסרה",
    },
    archive: "העברה לארכיון",
    restore: "החזרה מהארכיון",
    archiveNote: "קונספט בארכיון לא מוצע במפגש חדש. מפגשים קיימים לא משתנים.",
    archived: "הקונספט הועבר לארכיון",
    restored: "הקונספט חזר מהארכיון",
    delete: "מחיקת הקונספט",
    // The concept_delete dialog (lib/admin/sensitive-actions.ts has its
    // title).
    deleteDialog: {
      description: "אפשר למחוק רק קונספט שאין לו מפגשים. המחיקה סופית.",
      concept: "קונספט",
      confirm: (name: string) => `אני מאשרת למחוק את הקונספט ${name}`,
      submit: "מחיקה",
    },
    create: {
      title: "קונספט חדש",
      submit: "יצירת הקונספט",
    },
  },
  // /admin/sessions (story 3.1, wording approved by the user on 2026-10-04).
  sessions: {
    // The list's h1 and the session pages' <title> (user decision
    // 2026-10-08; the tab's label is shellCopy.nav.sessions).
    title: "לו״ז בראנצ׳ים",
    // The list's button and the home's action (user decision 2026-10-08).
    addBrunch: "בראנץ׳ חדש",
    // The title of a session is always the concept's name (no events.title).
    sessionTitle: (concept: string) => `בראנץ׳ ${concept}`,
    status: { draft: "טיוטה", published: "פורסם", cancelled: "בוטל" },
    // The list row's occupancy, as the admin home's tile (user decisions
    // 2026-10-10): after the title, the bare number, or "מלא" when no room is
    // left.
    occupancySeparator: " · ",
    occupancy: (occupied: number, capacity: number) =>
      `${occupied}/${capacity}`,
    listFull: "מלא",
    empty: 'אין מפגשים קרובים. "בראנץ׳ חדש" יוצר את הראשון',
    fields: {
      concept: "קונספט",
      date: "תאריך",
      startTime: "שעת התחלה",
      endTime: "שעת סיום",
      kind: "סוג",
      description: "תיאור (לא חובה)",
      capacity: "מכסת מבוגרים",
      price: "מחיר תצוגה (לא חובה)",
      when: "מועד",
      closes: "סגירת הרשמה",
    },
    kinds: { regular: "רגיל", couple: "זוגי" },
    // Hints under a field while it holds the value it was filled with.
    fromConcept: "מהקונספט",
    fromSettings: "לפי ההגדרות",
    priceEmpty: "מחיר תצוגה ריק: מוצג מחיר המוצר",
    closesByRule: "נקבעה לפי ההגדרות",
    closesScope: "שינוי כאן חל רק על המפגש הזה",
    // "{day} · 10:00–12:00" in the date row's "old ← new".
    when: (day: string, start: string, end: string) =>
      `${day} · ${start}–${end}`,
    // One create screen (user decision 2026-10-04): the close is optional
    // (empty = the settings' rule) and the session is saved as a draft or
    // published at once.
    create: {
      title: "מפגש חדש",
      submit: "יצירת טיוטה",
      publish: "פרסום",
      closes: "סגירת הרשמה (לא חובה)",
      // The settings' rule in words: days before the session and the time.
      closesRule: (daysBefore: number, time: string) => {
        const when =
          daysBefore === 0
            ? "ביום המפגש"
            : daysBefore === 1
              ? "ערב לפני המפגש"
              : `${daysBefore} ימים לפני המפגש`
        return `לפי ההגדרות: ${when} ב-${time}. אפשר לקבוע מועד אחר`
      },
      note: "טיוטה לא מוצגת ללקוחות. פרסום מציג את המפגש מיד",
      closesAfterStart: "סגירת ההרשמה צריכה להיות לפני תחילת המפגש",
    },
    publish: "פרסום המפגש",
    publishNote: "הטיוטה לא מוצגת ללקוחות עד הפרסום",
    duplicate: "שכפול לטיוטה",
    duplicateWhen: "מועד הטיוטה החדשה",
    duplicateSubmit: "יצירת הטיוטה",
    // The session's image (story 5.4): saving publishes it.
    image: {
      label: "תמונה (לא חובה)",
      hint: "בלי תמונה מוצגת תמונת הקונספט, אם יש",
      save: "שמירת התמונה",
      saved: "התמונה נשמרה ומוצגת באתר",
      removed: "התמונה הוסרה",
      // The session was created; its image was not saved (shown in the
      // session's editor, where the image is saved again).
      createdWithoutImage:
        "המפגש נוצר, אבל התמונה לא נשמרה. אפשר לבחור אותה שוב ולשמור כאן",
    },
    // The session's details, the morning view and the manual booking (story
    // 3.4, wording from the spec's design notes).
    attendees: "מי מגיעה",
    manualBooking: "רישום ידני",
    edit: "עריכה",
    // The session page's link to its work sheet, /admin/sessions/[id]/work
    // (user decision 2026-10-06, story 3.12 phone check; story 4.9).
    morningView: "ללשונית העבודה",
    toDetails: "לפרטי המפגש",
    bookForDate: "לרישום לתאריך",
    summary: {
      places: "מקומות",
      bookings: "נרשמות",
      babies: "תינוקות",
      allergies: "אלרגיות",
    },
    noAttendees: "עוד אין נרשמות",
    couple: "×2",
    pendingJoin: "לקוחה חדשה · ממתינה להצטרפות",
    detailsRemoved: "פרטי הלקוחה הוסרו",
    companion: (note: string) => `מלווה: ${note}`,
    // A baby's age on the session's day, computed for display only; the
    // age's wording is lib/copy/baby-age.ts (shared with the profile).
    babyLine: (name: string, age: string) => (age ? `${name} · ${age}` : name),
    // "מי מגיעה" on the session's details (user decision 2026-10-08): "{אמא}
    // - {תינוק} ({גיל})", several babies with a comma: the separator after
    // the mother's name (and "×2"), a baby's age after its name.
    namesSeparator: " - ",
    babyAgeSuffix: (age: string) => ` (${age})`,
    babiesSeparator: ", ",
    // "({n}/{n})" when every place is taken; a couple session with one place
    // left is full too.
    full: (occupied: number, capacity: number) =>
      `המפגש מלא (${occupied}/${capacity})`,
    raiseCapacity: "להעלות את המכסה",
    addPayment: "הוספת תשלום",
    willUse: (product: string, expiresOn: string) =>
      `ינוצל: כניסה מ${product}, בתוקף עד ${expiresOn}`,
    // Story 3.7: the session is an option of her cancellation credit.
    willUseCredit: (product: string) => `ינוצל: זיכוי מביטול של ${product}`,
    bookCustomer: (name: string) => `לרשום את ${name}`,
    booked: (name: string) => `${name} נרשמה למפגש`,
    bookAnother: "רישום לקוחה נוספת",
    chooseSession: "בחירת מפגש",
    // Several sessions at once for one customer (story 4.3, user decision
    // 2026-10-13): the bar, the sheet and the results.
    bookMany: {
      choose: (n: number) =>
        n === 1 ? "לרישום למפגש אחד" : `לרישום ל-${n} מפגשים`,
      // The selection cap (user decision 2026-10-13): her free entries
      // above the list, and the bar's counter.
      freeEntries: (n: number) =>
        n === 0
          ? "אין כניסות פנויות"
          : n === 1
            ? "כניסה פנויה אחת"
            : `${n} כניסות פנויות`,
      selectedCount: (selected: number, cap: number) =>
        `נבחרו ${selected} מתוך ${cap}`,
      sheetTitle: (name: string) => `רישום של ${name}`,
      confirm: "לאשר את הרישום",
      resultsHeading: (saved: number, total: number) =>
        `נרשמה ל-${saved} מתוך ${total}`,
      saved: "נשמר",
      notSaved: "לא נשמר",
      backToList: "חזרה לרשימה",
      close: "סגירה",
    },
    noBookableSessions: "אין מפגש פתוח לרישום",
    // Story 3.19 (user decision 2026-10-18): the open sessions her
    // entitlements can't fund are hidden; one line says how many.
    hiddenSessions: (n: number) =>
      n === 1
        ? "מפגש אחד לא מוצג כי אין לה זכות שמתאימה לו"
        : `${n} מפגשים לא מוצגים כי אין לה זכות שמתאימה להם`,
    noFundableSessions: "אין מפגש פתוח שהזכויות שלה מתאימות לו",
    // A refusal on the manual booking screen, worded for Tal (lib/errors.ts
    // speaks to the customer). Any other code keeps errorMessage.
    bookRefusal: {
      NO_MATCHING_ENTITLEMENT: "ללקוחה אין זכות שמתאימה למפגש הזה",
      ENTITLEMENT_EXPIRED_ON_DATE: "הזכות של הלקוחה אינה בתוקף ביום המפגש",
      EVENT_FULL: "המפגש מלא. כדי לרשום אותה צריך קודם להעלות את המכסה",
      EVENT_NOT_BOOKABLE: "המפגש לא פורסם, ולכן אי אפשר לרשום אליו",
    } as Record<string, string>,
    // Cancelling a booking from "מי מגיעה" (story 3.6); the dialog's title
    // is in lib/admin/sensitive-actions.ts (booking_cancel).
    cancel: {
      button: "ביטול",
      buttonLabel: (name: string) => `ביטול ההרשמה של ${name}`,
      description: "ההרשמה תבוטל והמקום יתפנה. הלקוחה תקבל הודעה באזור האישי.",
      // A place held for a new customer (no customer yet): no notification.
      descriptionNoCustomer: "ההרשמה תבוטל והמקום יתפנה.",
      customer: "לקוחה",
      session: "מפגש",
      returns: "מה יחזור",
      returnsCard: (product: string) => `כניסה אחת ל${product}`,
      // Story 3.7: a pinned booking becomes a credit or a refund request
      // (Tal chooses while the customer could still cancel herself); a
      // credit-funded booking gives the same credit back.
      returnsCredit: (n: number) => `ייווצר ללקוחה זיכוי ל-${n} מפגשים חלופיים`,
      returnsRefund: (amount: string) => `תיפתח בקשת החזר של ${amount}`,
      returnsSameCredit: "הזיכוי יחזור ללקוחה עם אותן חלופות",
      choiceCredit: "זיכוי למפגשים חלופיים",
      choiceRefund: "החזר כספי",
      // The confirm pressed before choosing (the checkbox's hint otherwise).
      choiceRequired: "צריך לבחור זיכוי או החזר כספי כדי להמשיך",
      withinWindow: "ההרשמה בתוך חלון הביטול, והלקוחה לא יכולה לבטל אותה בעצמה",
      reason: "סיבה (לא חובה)",
      checkbox: (name: string) =>
        `אני מאשרת את ביטול ההרשמה של ${name}, ושהביטול יירשם ביומן הפעולות`,
      confirm: "ביטול ההרשמה",
      done: (name: string) => `ההרשמה של ${name} בוטלה והמקום התפנה`,
    },
    // Moving a booking from "מי מגיעה" (story 3.10); the dialog's title is
    // in lib/admin/sensitive-actions.ts (booking_move).
    move: {
      button: "הזזה",
      buttonLabel: (name: string) => `הזזת ההרשמה של ${name}`,
      description:
        "ההרשמה תבוטל כאן ותירשם למפגש שתבחרי, מאותה זכות. הלקוחה תקבל הודעה באזור האישי.",
      customer: "לקוחה",
      from: "מהמפגש",
      targets: "לאיזה מפגש",
      // A target that is not one of the credit's options (pinned or
      // credit-funded); Tal may still choose it (user decision 2026-10-18).
      outsideOptions: "מחוץ לחלופות הזיכוי",
      // A pinned or credit-funded booking: after the move it is funded by
      // a credit (wording: user decision 2026-10-18, phone check).
      pinnedNote:
        "העברת ההרשמה תיחשב לביטול ושימוש בזיכוי. ביטול בהמשך יחזיר זיכוי למפגש אחר, ללא החזר כספי בהתאם למדיניות הביטולים.",
      choiceRequired: "צריך לבחור מפגש כדי להמשיך",
      empty: "אין מפגש שאפשר להעביר אליו את ההרשמה",
      // Hours from the booking's policy_snapshot; null when unreadable.
      withinWindow: (hours: number | null) =>
        hours === null
          ? "המפגש קרוב מדי, ולכן הלקוחה לא יכולה לשנות תאריך בעצמה."
          : `המפגש בעוד פחות מ־${hours} שעות, ולכן הלקוחה לא יכולה לשנות תאריך בעצמה.`,
      reason: "סיבה (לא חובה)",
      checkbox: (name: string) =>
        `אני מאשרת את הזזת ההרשמה של ${name}, ושההזזה תירשם ביומן הפעולות`,
      confirm: "הזזת ההרשמה",
      done: (name: string, date: string) =>
        `ההרשמה של ${name} הועברה ל-${date}`,
    },
    // Story 3.8: Tal cancels the whole session or moves it (the dialogs'
    // titles are in lib/admin/sensitive-actions.ts: event_cancel,
    // event_reschedule). The notice's body is prefilled from the template
    // and edited here; its title stays the template's.
    cancelEvent: {
      button: "ביטול מפגש",
      description:
        "כל ההרשמות יבוטלו, והנרשמות יקבלו הודעה בנוסח שלמטה. הביטול סופי.",
      session: "מפגש",
      bookings: "נרשמות",
      bookingsValue: (bookings: number, places: number) =>
        `${bookings} (${places} מקומות)`,
      cards: "כניסה חוזרת לכרטיסייה",
      choices: "בוחרות זיכוי או החזר",
      unbound: "מקום שמור ללקוחה חדשה",
      checkbox:
        "אני מאשרת לבטל את המפגש ולשלוח הודעה לנרשמות, ושהביטול יירשם ביומן הפעולות",
      confirm: "ביטול המפגש",
      // n: the customers notified; none (only held places) -> no count.
      done: (n: number) =>
        n === 0 ? "המפגש בוטל" : `המפגש בוטל ו-${n} נרשמות קיבלו הודעה`,
      // A purchase paid without a place on this session (user decision
      // 2026-10-13): one warning each, and the second required checkbox.
      parked: (name: string) =>
        `${name} שילמה למפגש הזה ואין לה מקום. אחרי הביטול היא תופיע ב'לטיפול', ותצטרכי לסגור איתה החזר או זיכוי ידנית.`,
      parkedCheckbox: "ידוע לי שיש לקוחה שצריכה טיפול ידני אחרי הביטול",
    },
    // Story 3.17: Tal deletes a draft or published session nobody booked
    // (the dialog's title: event_delete in lib/admin/sensitive-actions.ts).
    deleteEvent: {
      button: "מחיקת מפגש",
      description:
        "המפגש יימחק לגמרי, יחד עם דף העבודה שלו. אי אפשר לשחזר אותו.",
      session: "מפגש",
      dishes: "מנות בדף העבודה",
      tasks: "משימות בדף העבודה",
      shopping: "פריטים ברשימת הקניות",
      // The notice when the session is a credit alternative.
      creditsNotice: "המפגש מוצע כחלופה ללקוחות שקיבלו זיכוי.",
      creditsCustomers: (n: number) =>
        n === 1
          ? "לקוחה אחת תקבל מפגש חלופי אחר."
          : `${n} לקוחות יקבלו מפגש חלופי אחר.`,
      checkbox: "אני מאשרת למחוק את המפגש",
      confirm: "מחיקת המפגש",
      done: "המפגש נמחק.",
      // Next to EVENT_HAS_BOOKINGS while the session can be cancelled.
      cancelLink: "לביטול המפגש",
    },
    reschedule: {
      description: "ההרשמות נשארות, וכל נרשמת תקבל הודעה בנוסח שלמטה.",
      from: "מועד נוכחי",
      to: "מועד חדש",
      bookings: "נרשמות",
      checkbox:
        "אני מאשרת לשנות את מועד המפגש ולשלוח הודעה לנרשמות, ושהשינוי יירשם ביומן הפעולות",
      confirm: "שינוי המועד",
      done: (n: number) =>
        n === 0 ? "המפגש הוזז" : `המפגש הוזז ו-${n} נרשמות קיבלו הודעה`,
      // The plan's refusal by field (INVALID_INPUT).
      refusal: {
        event_id:
          "אי אפשר לשנות עוד את מועד המפגש: הוא כבר התחיל, בוטל או לא פורסם",
        start_time: "שעת ההתחלה החדשה צריכה להיות בעתיד ושונה מהמועד הנוכחי",
        end_time: "שעת הסיום צריכה להיות אחרי שעת ההתחלה",
        registration_closes_local:
          "סגירת ההרשמה נקבעה ידנית אחרי המועד החדש. צריך קודם להקדים אותה",
      } as Partial<Record<string, string>>,
    },
    // The notice slot and the at-risk list of both dialogs.
    eventNotice: {
      label: "נוסח ההודעה לנרשמות",
      title: (title: string) => `כותרת ההודעה: ${title}`,
      required: "צריך לכתוב את נוסח ההודעה כדי להמשיך",
    },
    atRisk: {
      cancelTitle: (n: number) =>
        n === 1
          ? "לקוחה אחת עלולה להישאר עם כניסה שאי אפשר לממש"
          : `${n} לקוחות עלולות להישאר עם כניסה שאי אפשר לממש`,
      rescheduleTitle: (n: number) =>
        n === 1
          ? "לקוחה אחת עם כרטיסייה שלא בתוקף ביום החדש"
          : `${n} לקוחות עם כרטיסייה שלא בתוקף ביום החדש`,
      reason: {
        expired: "כבר פגה",
        no_session_before_expiry: "אין מפגש מתאים לפני התפוגה",
        not_valid_on_new_day: "לא בתוקף ביום החדש",
      },
      line: (product: string, expiresOn: string) =>
        `${product}, בתוקף עד ${expiresOn}`,
      toCustomer: (name: string) => `לכרטיס של ${name}`,
    },
    // A refusal of the session cancel or move whose lib/errors.ts text speaks
    // to the customer, worded for Tal; any other code keeps errorMessage.
    eventRefusal: {
      MANUAL_HANDLING_REQUIRED:
        "יש במפגש הרשמה שמומנה משני סוגי כניסה. צריך לבטל אותה ידנית לפני ביטול המפגש",
    } as Partial<Record<ErrorCode, string>>,
    // A refusal of the cancellation, worded for Tal; any other code keeps
    // errorMessage.
    cancelRefusal: {
      MANUAL_HANDLING_REQUIRED:
        "ההרשמה מומנה משני סוגי כניסה, ולכן את הביטול שלה עושים ידנית",
      BOOKING_NOT_CANCELLABLE: "ההרשמה כבר לא פעילה. כדאי לרענן את הדף",
    } as Record<string, string>,
    // A refusal of the move (story 3.10), worded for Tal; any other code
    // keeps errorMessage.
    moveRefusal: {
      MANUAL_HANDLING_REQUIRED:
        "ההרשמה מומנה משני סוגי כניסה, ולכן אי אפשר להזיז אותה כאן",
      ALREADY_BOOKED: "הלקוחה כבר רשומה למפגש הזה. בחרי מפגש אחר",
      MOVE_TARGET_NOT_ALLOWED: "אי אפשר להעביר את ההרשמה למפגש הזה",
      BOOKING_NOT_MOVABLE:
        "אי אפשר להזיז את ההרשמה: היא כבר לא פעילה או שאין לה לקוחה",
      EVENT_ENDED: "המפגש כבר הסתיים, ולכן אי אפשר להזיז את ההרשמה",
      EVENT_FULL: "המפגש מלא. כדי להעביר אליו צריך קודם להעלות את המכסה",
      ENTITLEMENT_EXPIRED_ON_DATE: "הזכות של הלקוחה אינה בתוקף ביום המפגש",
      NO_MATCHING_ENTITLEMENT: "הזכות של הלקוחה לא מתאימה למפגש הזה",
      CONCURRENT_CHANGE: "ההרשמה השתנתה בינתיים. כדאי לרענן את הדף",
    } as Record<string, string>,
  },
  // value-change-row (story 2.6; EXPERIENCE › Component Patterns).
  valueChange: {
    change: (field: string, from: string, to: string) =>
      `${field}: ${from} ← ${to}`,
    save: "לשמור את השינוי",
    cancel: "ביטול",
    saved: "השינוי נשמר",
  },
  // sensitive-confirm-dialog (EXPERIENCE › Component Patterns).
  sensitive: {
    cancel: "ביטול",
    checkRequired: "צריך לסמן את האישור כדי להמשיך",
  },
  // /admin/links (story 2.4, wording approved by the user on 2026-10-03).
  links: {
    title: "קישורי הצטרפות",
    // Above the links of one purchase (/admin/links?payment=, story 4.1).
    allLinks: "לכל קישורי ההצטרפות",
    empty: "אין עדיין קישורי הצטרפות",
    rowTitle: {
      pending: "הקישור מחכה למימוש",
      expired: "הקישור פג בלי מימוש",
      revoked: "הקישור בוטל",
    },
    // "{payer label} · {row title}" until the link is used (story 2.5).
    rowTitleNamed: (label: string, title: string) => `${label} · ${title}`,
    // "{product} · {amount} · אושר {DD.MM}"; the amount arrives formatted.
    purchase: (product: string, amount: string, approvedOn: string) =>
      `${product} · ${amount} · אושר ${approvedOn}`,
    status: {
      pending: "ממתין למימוש",
      consumed: "מומש",
      expired: "פג תוקף",
      revoked: "בוטל",
    },
    validUntil: (weekday: string, dayMonth: string, time: string) =>
      `תקף עד ${weekday} ${dayMonth} · ${time}`,
    expiredOn: (dayMonth: string) => `פג ב-${dayMonth}`,
    revokedOn: (dayMonth: string) => `בוטל ב-${dayMonth}`,
    consumedOn: (dayMonth: string) => `מומש ב-${dayMonth}`,
    detail: {
      awaitingLogin: (name: string) => `ממתין להתחברות של ${name}`,
      stuck: "ההצטרפות נעצרה באמצע",
      conflict: (reason: string) => `נעצר, צריך בירור: ${reason}`,
    },
    reasons: {
      two_accounts: "מייל וטלפון של שתי לקוחות",
      not_activated: "חשבון שלא הופעל",
      phone_taken: "הטלפון כבר רשום",
      bind_conflict: "התנגשות בשיוך הרכישה",
      too_many_attempts: "יותר מדי ניסיונות",
    },
    revoke: "ביטול הקישור",
    replace: "הפקת קישור חלופי",
    confirmTitle: "לבטל את הקישור?",
    confirmBody: "הלקוחה לא תוכל להשתמש בו",
    confirmYes: "כן, לבטל",
    confirmBack: "חזרה",
    revoked: "הקישור בוטל",
    replaced: "הקישור החלופי מוכן לשליחה. הקישור הקודם בוטל",
    // LINK_USED on revoke or replace: the customer joined while the list was
    // open (user decision 2026-10-03); the list then reloads.
    linkUsed: "הקישור כבר מומש",
    // "Send on WhatsApp" on a row: a replacement sent at once (user decision
    // 2026-10-03); no link is shown afterwards.
    sent: "נוצר קישור חדש. הקישור הקודם בוטל",
  },
  // /admin (story 4.1, CAP-24). The sum is "approved payments minus
  // refunds"; never "profit" or "income" (source §7).
  home: {
    // The h1 of the admin home by the time of day in Jerusalem and her
    // first name (user decision 2026-10-08); "היי" without a known time.
    greeting: {
      morning: "בוקר טוב",
      noon: "צהריים טובים",
      evening: "ערב טוב",
      night: "לילה טוב",
      unknown: "היי",
    },
    greetingWithName: (greeting: string, name: string) =>
      `${greeting}, ${name}`,
    // While the time is unknown: "היי {שם}", as on the customer home.
    hiWithName: (name: string) => `היי ${name}`,
    nextSession: "המפגש הבא",
    // The only link of a session-tile (design round, user decision
    // 2026-10-08: "לדף העבודה" left the home).
    sessionDetails: "לפרטי המפגש",
    allSessions: "לכל המפגשים",
    noSessions: "אין מפגשים קרובים",
    toSessions: "למפגשים",
    attention: "לטיפול",
    attentionCount: (n: number) =>
      n === 1 ? "דבר אחד מחכה לך" : `${n} דברים מחכים לך`,
    attentionEmpty: "אין כרגע דברים לטיפול",
    // Under the three newest items on the home, to /admin/attention.
    attentionAll: (n: number) => `לכל הדברים לטיפול (${n})`,
    // The customer: full_name, else the payer label Tal gave, else this.
    newCustomer: "לקוחה חדשה",
    since: (dayMonth: string) => `מאז ${dayMonth}`,
    // The title says what happened, the detail what to do (user decision
    // 2026-10-06, after the phone check). Chips unchanged.
    items: {
      link_conflict: {
        chip: "התנגשות",
        // By conflict_reason; an unknown reason reads as bind_conflict.
        reasons: {
          two_accounts: {
            title: (name: string) => `ההצטרפות של ${name} נעצרה`,
            detail:
              "המייל והטלפון שייכים לשתי לקוחות שונות. צריך לברר איתה ולהפיק קישור חדש",
          },
          not_activated: {
            title: (name: string) => `ההצטרפות של ${name} נעצרה`,
            detail:
              "המייל שייך לחשבון שעוד לא הופעל. צריך לברר איתה ולהפיק קישור חדש",
          },
          phone_taken: {
            title: (name: string) => `ההצטרפות של ${name} נעצרה`,
            detail:
              "הטלפון כבר רשום אצל לקוחה אחרת. צריך לברר איתה ולהפיק קישור חדש",
          },
          too_many_attempts: {
            title: (name: string) => `ההצטרפות של ${name} ננעלה`,
            detail:
              "3 ניסיונות עם פרטים שלא מתאימים. צריך לברר איתה ולהפיק קישור חדש",
          },
          bind_conflict: {
            title: (name: string) => `הרכישה של ${name} לא נוספה לחשבון שלה`,
            detail:
              "כבר רשומה לאותו מפגש או כבר השתתפה בהיכרות. צריך להחליט מה לעשות ברכישה",
          },
        },
      },
      link_stuck: {
        title: (name: string) => `${name} לא סיימה להצטרף`,
        detail: "התחילה ולא סיימה. פתיחה חוזרת של אותו קישור תמשיך מאותה נקודה",
        chip: "תקוע",
      },
      purchase_without_link: {
        title: (name: string) => `ל${name} אין קישור הצטרפות בתוקף`,
        // The purchase's details are on the links card it opens.
        detail:
          "הקישור פג או בוטל לפני שהצטרפה. אפשר להפיק קישור חדש בלי תשלום נוסף",
        chip: "פג תוקף",
      },
      paid_without_place: {
        title: (name: string) => `${name} שילמה ואין לה מקום`,
        detail: (concept: string, dayMonth: string) =>
          `שילמה לבראנץ׳ ${concept} ${dayMonth} והמפגש היה מלא. צריך למצוא מקום או להחליט על החזר`,
        chip: "צריך מקום",
        // Story 3.8: the business cancelled that session.
        cancelledDetail: (concept: string, dayMonth: string) =>
          `שילמה לבראנץ׳ ${concept} ${dayMonth} והמפגש בוטל. אפשר להציע לה החזר או זיכוי`,
        cancelledChip: "בוטל",
        // Story 3.13: the parked_settle dialog (like a business cancel).
        settle: "הצעת החזר או זיכוי",
        settleFor: (name: string) => `הצעת החזר או זיכוי ל${name}`,
        settleDescription:
          "הלקוחה תקבל הודעה שהמפגש בוטל ותבחר באזור האישי בין החזר לזיכוי, כמו בביטול מפגש.",
        settleDescriptionNoCustomer:
          "הלקוחה עוד לא הצטרפה. ההודעה והבחירה יגיעו אליה כשתצטרף.",
        settleCustomer: "לקוחה",
        settleSession: "מפגש",
        settleAmount: "שולם",
        settleCheckbox: (name: string) =>
          `אני מאשרת להציע ל${name} החזר או זיכוי על המפגש שבוטל`,
        settleConfirm: "הצעת החזר או זיכוי",
        settleDone: "ההצעה נשלחה ללקוחה",
        // A purchase not bound yet: she hears about it when she joins.
        settleDoneNoCustomer: "ההצעה נשמרה ותגיע ללקוחה כשתצטרף",
      },
      pinned_seat_held: {
        title: (name: string) => `מקום שמור למי שלא הצטרפה (${name})`,
        detail: (concept: string, dayMonth: string) =>
          `הרכישה לא נוספה לחשבון, והמקום בבראנץ׳ ${concept} ${dayMonth} תפוס. אפשר לשחרר בעמוד המפגש`,
        chip: "תופס מקום",
      },
      media_stuck: {
        title: () => "תמונה לא פורסמה עד הסוף",
        detail: "הפרסום נעצר באמצע. כדי לסיים, פרסמי שוב את העמוד בתוכן האתר",
        chip: "תקוע",
      },
      // Until the first publish of the statement (story 5.5).
      accessibility_unpublished: {
        title: () => "הצהרת הנגישות עוד לא פורסמה",
        detail: "זה עמוד חובה באתר. צריך למלא את שדות החובה ולפרסם",
        chip: "לא פורסם",
      },
      // An open refund request (story 3.7), until Tal completes it (3.9):
      // to the customer's card. No chip and no "בוצע" before 3.9.
      refund_requested: {
        title: (name: string, amount: string, concept: string, day: string) =>
          `${name} ביקשה החזר של ${amount} על בראנץ׳ ${concept} ${day}`,
      },
      // A business cancel she has not chosen for yet (story 3.8): refund or
      // credit, no deadline; to the customer's card. No chip.
      choice_pending: {
        title: (name: string, concept: string, day: string) =>
          `${name} עוד לא בחרה זיכוי או החזר על בראנץ׳ ${concept} ${day}`,
      },
      // A booking that no longer fits its card after Tal corrected it
      // (story 3.13): to the card's page; "טופל" removes it.
      correction_affected: {
        title: (name: string) =>
          `הרשמה שלא מתאימה לכרטיסייה אחרי תיקון (${name})`,
        detail: (concept: string, day: string) =>
          `בראנץ׳ ${concept} ${day}. ההרשמה נשארה כפי שהיא. אפשר לבטל או להעביר אותה, או לסמן שטופל`,
        chip: "לבדיקה",
        handled: "טופל",
        handledFor: (name: string) => `סימון שטופל: ${name}`,
        handledDone: "סומן שטופל",
      },
      // An email change stuck between its steps for more than 15 minutes
      // (story 2.8): to the customer's card, where saving the same address
      // again finishes it.
      email_change_stuck: {
        title: (name: string) => `שינוי המייל של ${name} לא הושלם`,
        detail: "שינוי המייל לא הושלם. כדי לסיים, שמרי שוב את המייל החדש",
        chip: "תקוע",
      },
      // Push notifications that failed in the last 7 days (story 5.8): one
      // item for all of them; the notifications themselves are in the
      // centers.
      push_failed: {
        title: (count: number) =>
          count === 1
            ? "התראת פוש אחת לא נשלחה השבוע"
            : `${count} התראות פוש לא נשלחו השבוע`,
        detail:
          "ההתראות עצמן נשמרו במרכז ההתראות. אם זה חוזר, צריך לבדוק את הגדרות הפוש של האתר",
        chip: "לא נשלח",
      },
    },
    expiring: "כרטיסיות שעומדות לפוג",
    // "{n} כניסות שלא נרשמה אליהן · בתוקף עד DD.MM" (free entries: not
    // used and not booked; user decision 2026-10-06). The two parts are
    // separate so "בתוקף עד DD.MM" never breaks apart.
    expiringEntries: (available: number) =>
      available === 1
        ? "כניסה אחת שלא נרשמה אליה"
        : `${available} כניסות שלא נרשמה אליהן`,
    expiringUntil: (until: string) => `בתוקף עד ${until}`,
    expiringChip: "עומדת לפוג",
    expiringEmpty: "אין כרטיסיות שעומדות לפוג",
    totalsTitle: "תשלומים שאושרו פחות החזרים",
    // "{month} {year} · עד היום"
    totalsPeriod: (monthYear: string) => `${monthYear} · עד היום`,
    totalsApproved: (n: number) => `תשלומים שאושרו (${n})`,
    // Story 3.7: the refunds completed in the month (3.9), always shown.
    totalsRefunded: (n: number) => `החזרים שבוצעו (${n})`,
    // Open refund requests: "{customer} · {amount} · בראנץ׳ {concept}
    // {DD.MM}", each to the customer's card.
    openRefunds: "בקשות החזר פתוחות",
    openRefundRow: (
      customer: string,
      amount: string,
      concept: string,
      day: string
    ) => `${customer} · ${amount} · בראנץ׳ ${concept} ${day}`,
  },
  // The work tab and a session's work sheet (story 4.9, CAP-38; wording
  // from EXPERIENCE › דף עבודה and the mockup).
  work: {
    // /admin/work: the next three published sessions.
    tabTitle: "עבודה",
    tabIntro: "דפי העבודה של הבראנצ׳ים הקרובים",
    noSessions: "אין בראנצ׳ים קרובים",
    toSessions: "למפגשים",
    // Under the list, to /admin/sessions (user decision 2026-10-08).
    allBrunches: "לכל הבראנצ׳ים",
    // The work sheet's <title>.
    title: "דף עבודה",
    dishes: "מנות",
    addDish: "+ מנה",
    addDay: "+ יום הכנה",
    empty: "עוד אין מנות לבראנץ׳ הזה",
    // The prep days, relative to the session day.
    days: "ימי הכנה",
    dayLabel: (offset: number) =>
      offset === 0
        ? "יום המפגש"
        : offset === -1
          ? "יום לפני"
          : `${-offset} ימים לפני`,
    // "ד׳ 21.10 · יום לפני"
    dayHeading: (date: string, label: string) => `${date} · ${label}`,
    removeDay: "הסרת היום",
    removeDayNamed: (day: string) => `הסרת ${day}`,
    removeDayTitle: (day: string) => `להסיר את ${day}?`,
    removeDayTasks: (n: number) =>
      n === 1
        ? "משימה אחת של היום הזה תימחק מכל המנות"
        : `${n} משימות של היום הזה יימחקו מכל המנות`,
    dayRemoved: (day: string) => `${day} הוסר`,
    dayAdded: (day: string) => `${day} נוסף`,
    // "+ יום הכנה" adds the day before the earliest, else the free day
    // closest to the session (story 4.10, round 2); disabled once every day
    // up to six days before is on the sheet.
    addDayLimit: "כל הימים עד שישה ימים לפני המפגש כבר בדף",
    // An added day: a tap on its weekday and date moves it to a free day.
    moveDayNamed: (day: string) => `העברת היום ${day}`,
    moveDayTitle: (day: string) => `העברת היום ${day}`,
    moveDayLegend: "לאיזה יום להעביר?",
    moveDayNote: "המשימות של היום עוברות איתו",
    moveDay: "העברה",
    dayMoved: (from: string, to: string) => `${from} הועבר ליום ${to}`,
    // The dish form and the dish's sheet.
    dishName: "שם המנה",
    add: "הוספה",
    save: "שמירה",
    cancel: "ביטול",
    close: "סגירה",
    delete: "מחיקה",
    edit: "עריכה",
    editDish: (name: string) => `עריכת ${name}`,
    moveUp: "הזזה למעלה",
    moveDown: "הזזה למטה",
    moved: (name: string, position: number, total: number) =>
      `${name} עכשיו במקום ${position} מתוך ${total}`,
    deleteDish: "מחיקת המנה",
    deleteDishConfirm: (n: number) =>
      n === 0
        ? "למחוק את המנה?"
        : n === 1
          ? "למחוק את המנה ואת המשימה שלה?"
          : `למחוק את המנה ואת ${n} המשימות שלה?`,
    // Tasks.
    addTask: "+ משימה",
    addTaskFor: (day: string) => `הוספת משימה ל${day}`,
    taskBody: "משימה",
    taskDay: "יום",
    editTask: (body: string) => `עריכת ${body}`,
    taskSheet: "עריכת משימה",
    deleteTask: "מחיקת המשימה",
    // Announced after the save (EXPERIENCE › check-item).
    markedDone: (body: string) => `${body}: סומן כבוצע`,
    markedNotDone: (body: string) => `${body}: הסימון בוטל`,
    // The desktop table.
    tableCaption: "מנות ומשימות",
    dishColumn: "מנה",
    // Story 4.10: print, registrants, diet and shopping.
    print: "הדפסה",
    // The printed head: "דף עבודה · {קונספט}", then the session's line.
    printTitle: (concept: string) => `דף עבודה · ${concept}`,
    printMeta: (when: string, bookings: number) =>
      `${when} · ${bookings === 1 ? "הרשמה אחת" : `${bookings} הרשמות`}`,
    // One table on the phone, on desktop and in print (round 2): name,
    // babies, photo consent, diet and allergies; the count is of bookings.
    attendees: (n: number) => `נרשמות, תמונות ותזונה (${n})`,
    attendeesCaption: "נרשמות, תמונות ותזונה",
    colName: "שם",
    // Its cell: adminCopy.photoConsents marks (story 2.13).
    colConsent: "אישור תמונות",
    diet: "תזונה ואלרגיות",
    shopping: "רשימת קניות",
    noShopping: "עוד אין פריטים ברשימה",
    addItem: "+ פריט",
    itemBody: "מה לקנות",
    // "+ פריט" (round 2): one text box, an item per line.
    addItemsTitle: "הוספת פריטים",
    itemLines: "פריטים, כל פריט בשורה",
    itemLinesHint: "Enter לשורה חדשה. שורות ריקות לא נספרות",
    itemsTooMany: (max: number) => `אפשר להוסיף עד ${max} פריטים בכל פעם`,
    itemTooLong: (max: number) => `כל שורה עד ${max} תווים`,
    itemsAdded: (n: number) =>
      n === 1 ? "פריט אחד נוסף" : `${n} פריטים נוספו`,
    // "פטה כבשים · 1 ק״ג"
    itemLine: (body: string, quantity: string | null) =>
      quantity ? `${body} · ${quantity}` : body,
    editItem: (body: string) => `עריכת ${body}`,
    // The item's window: "עריכת {פריט}", and the delete question names it.
    itemSheet: (body: string) => `עריכת ${body}`,
    deleteItem: "מחיקת הפריט",
    deleteItemNamed: (body: string) => `למחוק את ${body}?`,
    itemsProblemEmpty: "צריך לכתוב לפחות פריט אחד",
    markedBought: (body: string) => `${body}: סומן כנקנה`,
    markedNotBought: (body: string) => `${body}: הסימון בוטל`,
    sendWhatsapp: "שליחת הרשימה בוואטסאפ",
    // Why the WhatsApp button cannot be used (aria-disabled + the reason).
    whatsappEmpty: "אין פריטים לשליחה",
    whatsappAllBought: "כל הפריטים כבר נקנו",
    // The WhatsApp message's first line: "רשימת קניות · יווני 22.10".
    shoppingMessageTitle: (concept: string, date: string) =>
      `רשימת קניות · ${concept} ${date}`,
  },
  // /admin/settings and /admin/settings/templates (story 4.7; EXPERIENCE ›
  // admin states › settings, template). Every change is a value-change-row.
  settings: {
    title: "הגדרות",
    groups: {
      business: "פרטי העסק",
      registration: "הרשמה וביטול",
      newSession: "מפגש חדש",
      newProduct: "מוצר חדש",
      creditReminder: "זיכוי ותזכורת",
      alerts: "התראות וספים",
      workSheet: "דף עבודה",
      templates: "תבניות התראות",
    },
    // The links of the first and last groups.
    businessLink: "לעריכת פרטי העסק",
    businessNote: "אותם פרטים כמו בתוכן האתר › יצירת קשר",
    templatesLink: "לנוסח ההתראות",
    templatesNote: "הכותרת והטקסט של כל התראה",
    fields: {
      close: "סגירת הרשמה",
      closeDays: "ימים לפני המפגש",
      closeTime: "שעה",
      cancelWindow: "חלון ביטול עצמי (שעות לפני המפגש)",
      sessionHours: "שעות מפגש חדש",
      sessionStart: "שעת התחלה",
      sessionEnd: "שעת סיום",
      capacityRegular: "מכסה למפגש רגיל",
      capacityCouple: "מכסה למפגש זוגי",
      validity: "תוקף למוצר חדש (ימים)",
      creditOptions: "מספר חלופות לזיכוי",
      reminder: "תזכורת לפני מפגש (שעות)",
      adminExpiring: '"עומדת לפוג" אצלך (ימים לפני התפוגה)',
      customerExpiring: '"עומדת לפוג" אצל הלקוחה (ימים לפני התפוגה)',
      lastPlaces: '"מקומות אחרונים" (מקומות פנויים או פחות)',
      inactivity: "לקוחה לא פעילה אחרי (חודשים)",
      duplicateWindow: "זיהוי תשלום כפול (ימים לפני ואחרי)",
      prepDays: "ימי הכנה בדף העבודה",
    },
    // The short names in "{field}: {old} ← {new}".
    labels: {
      close: "סגירת הרשמה",
      cancelWindow: "חלון ביטול עצמי",
      sessionHours: "שעות מפגש חדש",
      capacityRegular: "מכסה למפגש רגיל",
      capacityCouple: "מכסה למפגש זוגי",
      validity: "תוקף למוצר חדש",
      creditOptions: "חלופות לזיכוי",
      reminder: "תזכורת לפני מפגש",
      adminExpiring: '"עומדת לפוג" אצלך',
      customerExpiring: '"עומדת לפוג" אצל הלקוחה',
      lastPlaces: '"מקומות אחרונים"',
      inactivity: "לקוחה לא פעילה",
      duplicateWindow: "זיהוי תשלום כפול",
      prepDays: "ימי הכנה",
    },
    // Readable values ("יום לפני ב-20:00", "48 שעות").
    show: {
      close: (daysBefore: number, time: string) =>
        daysBefore === 0
          ? `ביום המפגש ב-${time}`
          : daysBefore === 1
            ? `יום לפני ב-${time}`
            : daysBefore === 2
              ? `יומיים לפני ב-${time}`
              : `${daysBefore} ימים לפני ב-${time}`,
      hours: (n: number) => (n === 1 ? "שעה אחת" : `${n} שעות`),
      hoursBefore: (n: number) =>
        n === 1 ? "שעה לפני המפגש" : `${n} שעות לפני המפגש`,
      days: (n: number) => (n === 1 ? "יום אחד" : `${n} ימים`),
      months: (n: number) => (n === 1 ? "חודש אחד" : `${n} חודשים`),
      adults: (n: number) => `${n} מבוגרים`,
      options: (n: number) => (n === 1 ? "חלופה אחת" : `${n} חלופות`),
      places: (n: number) => `${n} מקומות פנויים או פחות`,
      sessionHours: (start: string, end: string) => `${start}–${end}`,
      // A prep day relative to the session (0 = the session's day).
      prepDay: (offset: number) =>
        offset === 0
          ? "יום המפגש"
          : offset === -1
            ? "יום לפני"
            : offset === -2
              ? "יומיים לפני"
              : `${-offset} ימים לפני`,
      prepDays: (labels: readonly string[]) => labels.join(" · "),
    },
    scope: {
      new: "חל רק על מה שייווצר מעכשיו",
      bookings: "חל רק על הרשמות חדשות",
      credits: "חל רק על זיכויים חדשים",
    },
    // Next to the cancel window (source §7: a visible policy change).
    cancelPolicy:
      "שינוי מדיניות שמוצג ללקוחות. הרשמות קיימות שומרות את החלון שהיה בעת ההרשמה. כדאי לעדכן גם את נוסח התנאים",
    termsLink: "לעריכת תנאי השימוש",
    // Under a number out of the allowed range.
    range: (min: number, max: number) => `צריך מספר שלם בין ${min} ל-${max}`,
    timeInvalid: "צריך שעה בפורמט 20:00",
    closeTimeEarly: "שעת הסגירה צריכה להיות בין 03:00 ל-23:59",
    endBeforeStart: "שעת הסיום צריכה להיות אחרי שעת ההתחלה",
    prepDaysEmpty: "צריך לבחור לפחות יום הכנה אחד",
    // /admin/settings/templates
    templates: {
      title: "תבניות התראות",
      back: "להגדרות",
      backToList: "לכל התבניות",
      recipient: { customer: "ללקוחה", admin: "לטל" },
      push: "גם כהתראה בטלפון",
      types: {
        purchase_new_card: "כרטיסייה חדשה",
        purchase_repeat: "רכישה נוספת",
        booking_confirmed: "ההרשמה אושרה",
        booking_confirmed_couple: "אישור הרשמה זוגית",
        booking_moved: "הזזת הרשמה",
        reminder: "תזכורת לפני מפגש",
        waitlist_spot: "התפנה מקום",
        booking_cancelled: "ביטול הרשמה מכרטיסייה",
        booking_cancelled_pinned: "ביטול הרשמה עם זיכוי",
        booking_cancelled_refund: "ביטול הרשמה עם בקשת החזר",
        refund_completed: "ההחזר בוצע",
        // Story 3.16: Tal changed a credit, or replaced it with a refund.
        credit_options_changed: "עדכון חלופות הזיכוי",
        credit_refund_requested: "החזר במקום זיכוי",
        event_changed: "שינוי במפגש",
        event_cancelled: "ביטול מפגש",
        // Story 3.13: one template per correction of a card.
        entitlement_changed: "עדכון תוקף הכרטיסייה",
        entitlement_units_changed: "עדכון יתרה בכרטיסייה",
        entitlement_terms_changed: "עדכון תנאי הכרטיסייה",
        // Story 3.14: a week with no fitting brunch extended the card.
        entitlement_auto_extended: "הארכה אוטומטית של כרטיסייה",
        card_expiring: "כרטיסייה עומדת לפוג",
        broadcast: "הודעה כללית",
        admin_card_expiring: "כרטיסייה של לקוחה עומדת לפוג",
        marketing_reminder: "תזכורת שיווק",
      } as Record<string, string>,
      // The {fields}: the chip's name and the preview's sample value.
      fieldNames: {
        date: "תאריך",
        time: "שעה",
        concept: "קונספט",
        product: "מוצר",
        expires_on: "בתוקף עד",
        card_tip: "המלצה לכרטיסייה",
        new_date: "תאריך חדש",
        new_time: "שעה חדשה",
        units: "כניסות",
        customer: "שם הלקוחה",
        amount: "סכום",
        from_date: "תאריך קודם",
      } as Record<string, string>,
      samples: {
        date: "12.11",
        time: "10:30",
        concept: "אמהות",
        product: "כרטיסייה 4 מפגשים",
        expires_on: "31.12",
        card_tip: ". מומלץ להירשם מראש למפגשים",
        new_date: "19.11",
        new_time: "11:00",
        units: "3",
        customer: "נועה לוי",
        amount: "180 ₪",
        from_date: "05.11",
      } as Record<string, string>,
      fields: {
        title: "כותרת",
        body: "טקסט ההתראה",
      },
      fieldsLegend: "שדות שאפשר להוסיף",
      fieldsHint:
        "לחיצה מוסיפה את השדה במקום הסמן. בהתראה הוא מתחלף בערך האמיתי",
      noFields: "להתראה הזו אין שדות. הנוסח נשלח כמו שהוא",
      overrideNote: "טקסט ההתראה נכתב בכל שליחה, ולכן כאן נערכת רק הכותרת",
      // purchase_new_card: admin_approve_payment adds its body as the tip
      // ({card_tip}) of the repeat-purchase notification of a card.
      cardTipNote:
        "הגוף של ההתראה הזו מופיע גם כהמלצה בהתראת רכישה חוזרת של כרטיסייה",
      preview: "תצוגה מקדימה",
      previewNote: "עם ערכים לדוגמה",
      previewTime: "עכשיו",
      scope: "חל על התראות חדשות בלבד",
      unknownField: (field: string) =>
        `השדה {${field}} לא קיים בהתראה הזו. אפשר להוסיף רק שדות מהרשימה`,
      unbalanced: "יש סוגריים מסולסלים שלא נסגרו. כל שדה נכתב כך: {שם}",
      tooLong: (max: number) => `אפשר עד ${max} תווים`,
    },
  },
  // /admin/customers and the customer card (story 4.2, CAP-25; after the
  // phone check, user decision 2026-10-07). Internal notes are marked as
  // Tal's only.
  customers: {
    title: "לקוחות",
    searchLabel: "חיפוש לפי שם או טלפון",
    searchHint: "התוצאות מופיעות אחרי שתי אותיות או ספרות",
    lastActivity: (date: string) => `פעילות אחרונה ${date}`,
    noActivity: "אין עדיין פעילות",
    notActivated: "לא הופעלה",
    empty: "לא נמצאו לקוחות",
    hasMore: (limit: number) => `מוצגות ${limit} הראשונות. אפשר לחפש`,
    // The segmented-switch on /admin/customers and its open cards (story
    // 4.3, CAP-42): two links, the current one aria-current.
    switchNav: "תצוגות הלקוחות",
    // /admin/customers/open-cards (story 4.3, CAP-42).
    openCards: {
      title: "כרטיסיות פתוחות",
      filtersNav: "סינון הכרטיסיות",
      filters: {
        all: "הכול",
        available: "יש כניסות פנויות",
        expiring: "עומדת לפוג",
      },
      purchased: (dayMonth: string) => `נרכשה ${dayMonth}`,
      book: "לרישום למפגש",
      profile: "לפרופיל",
      // The two buttons of a row, named for a screen reader.
      bookFor: (name: string) => `לרישום למפגש של ${name}`,
      profileOf: (name: string) => `לפרופיל של ${name}`,
      // A purchase not bound to an account yet, instead of the two buttons
      // (user decision 2026-10-13; the payments list's wording).
      notJoined: "עוד לא הצטרפה",
      // Story 3.13: the card's page.
      details: "פרטים ותיקונים",
      detailsFor: (name: string) => `פרטים ותיקונים בכרטיסייה של ${name}`,
      empty: "אין כרטיסיות פתוחות כרגע",
      // Story 3.13: after the expiry, when a correction extended it.
      extended: "(כולל הארכה)",
      showAll: "להצגת כל הכרטיסיות",
    },
    // customers/[id]/entitlements/[entitlementId] (story 3.13): one card,
    // its terms and Tal's corrections (each a sensitive action).
    entitlement: {
      title: "פרטי כרטיסייה",
      backToCustomer: (name: string) => `לכרטיס של ${name}`,
      backToOpenCards: "לכרטיסיות הפתוחות",
      purchased: (date: string) => `נרכשה ${date}`,
      // A pinned purchase, a revoked or a refunded one.
      notCorrectable:
        "אפשר לתקן רק כרטיסייה פעילה. כניסה למפגש מסוים לא משתנה כאן.",
      termsTitle: "תוקף ותנאים",
      fields: {
        expires_on: "בתוקף עד",
        units: "כניסות פנויות",
        allowed_weekdays: "ימים",
        eligible_event_kind: "סוג מפגש",
      } as Record<string, string>,
      allDays: "כל הימים",
      // allowed_weekdays, 0 = Sunday.
      weekdays: [
        "ראשון",
        "שני",
        "שלישי",
        "רביעי",
        "חמישי",
        "שישי",
        "שבת",
      ] as readonly string[],
      kinds: { regular: "רגיל", couple: "זוגי" } as Record<string, string>,
      change: "שינוי",
      changeFor: (field: string) => `שינוי ${field}`,
      // The edit box under a row.
      newExpiry: "תאריך חדש",
      newUnits: "כמה כניסות פנויות יהיו בכרטיסייה",
      unitsHint: (reserved: number) =>
        reserved === 0
          ? "בלי הכניסות שכבר נוצלו"
          : `בלי הכניסות שכבר נוצלו ובלי ${reserved} ששוריינו להרשמות`,
      newWeekdays: "הימים שאפשר להירשם בהם",
      newKind: "סוג המפגשים שאפשר להירשם אליהם",
      related: "מפגש שהתיקון קשור אליו (לא חובה)",
      relatedNone: "בלי מפגש",
      reason: "סיבה (לא חובה)",
      next: "המשך",
      cancel: "ביטול",
      // The dialog.
      customer: "לקוחה",
      before: "לפני",
      after: "אחרי",
      relatedSession: "מפגש",
      reasonRow: "סיבה",
      affectedTitle: "הרשמות שכבר לא יתאימו (הן יישארו כפי שהן)",
      affectedHint: "הן יופיעו ב״לטיפול״ עד שיבוטלו, יועברו, או שתסמני שטופלו.",
      descriptions: {
        expires_on:
          "הלקוחה תקבל הודעה עם התוקף החדש. כניסות שחזרו לכרטיסייה יהיו זמינות לפי התוקף החדש.",
        units: "הלקוחה תקבל הודעה עם היתרה החדשה. הרשמות קיימות לא משתנות.",
        terms: "הלקוחה תקבל הודעה שהתנאים השתנו. הרשמות קיימות לא משתנות.",
      },
      checkbox: {
        expires_on: (name: string) =>
          `אני מאשרת לשנות את התוקף של הכרטיסייה של ${name}`,
        units: (name: string) => `אני מאשרת לתקן את היתרה בכרטיסייה של ${name}`,
        terms: (name: string) =>
          `אני מאשרת לשנות את התנאים של הכרטיסייה של ${name}`,
      },
      confirm: {
        expires_on: "עדכון התוקף",
        units: "תיקון היתרה",
        terms: "שינוי התנאים",
      },
      done: "התיקון נשמר והלקוחה קיבלה הודעה",
      doneNoCustomer: "התיקון נשמר",
      // A refusal of INVALID_INPUT, by detail.field.
      refusal: {
        expires_on: "התאריך צריך להיות תקין ולא לפני תחילת התוקף",
        units: "מספר הכניסות צריך להיות מספר שלם בין 0 ל-99",
        allowed_weekdays: "צריך לבחור לפחות יום אחד",
        eligible_event_kind: "צריך לבחור סוג מפגש",
        reason: "הסיבה ארוכה מדי",
        related_event: "המפגש שנבחר לא שייך לכרטיסייה הזו",
      } as Record<string, string>,
      noChange: "זה כבר הערך הנוכחי",
      historyTitle: "היסטוריית תיקונים",
      historyEmpty: "עוד לא נעשו תיקונים בכרטיסייה",
      // Never "{שדה}: {ישן} ← {חדש}" (user decision 2026-10-18).
      historyChange: (field: string, from: string, to: string) =>
        `${field}: היה ${from}, עכשיו ${to}`,
      // Story 3.14: a system correction (job_auto_extend) and its week.
      historyAutoExtend: (from: string, to: string) =>
        `הארכה אוטומטית: היה ${from}, עכשיו ${to}`,
      historyWeek: (start: string, end: string) =>
        `שבוע ${start}–${end} בלי בראנץ׳ מתאים`,
      historyWho: (actor: string, date: string) => `${actor}, ${date}`,
      historyReason: (reason: string) => `סיבה: ${reason}`,
      historySession: (title: string) => `מפגש: ${title}`,
    },
    card: {
      back: "לכל הלקוחות",
      details: "פרטים",
      email: "מייל",
      joined: "הצטרפה",
      notActivatedYet: "עוד לא הופעלה",
      // The last participation, purchase or booking (from the server).
      lastActivity: "פעילות אחרונה",
      dietary: "תזונה ואלרגיות",
      none: "לא נכתב",
      // Two lines, no date (story 2.13): adminCopy.photoConsents.
      photoConsent: "אישור תמונות",
      babies: "תינוקות",
      noBabies: "לא נוספו תינוקות",
      balances: "יתרות ותוקף",
      noBalances: "אין כרטיסיות או כניסות",
      // Story 3.19 (user decision 2026-10-19): manual booking from her card.
      book: "לרישום למפגש",
      // Story 3.9: her cancellation credits and refunds, after the
      // balances. Title: the cancelled session "בראנץ׳ {concept} {DD.MM}".
      credits: {
        title: "זיכויים והחזרים",
        empty: "אין זיכויים או בקשות החזר",
        sessionTitle: (concept: string, day: string) =>
          `בראנץ׳ ${concept} ${day}`,
        chips: {
          active: "זיכוי פעיל",
          used: "נוצל",
          pending: "ממתינה לבחירה",
          requested: "בקשת החזר",
          refunded: "הוחזר",
        },
        // The line under the title, by state.
        worth: (amount: string) => `זיכוי בשווי ${amount}`,
        pendingLine: "המפגש בוטל. היא עוד לא בחרה זיכוי או החזר",
        requestedLine: (amount: string, day: string) =>
          `ביקשה החזר של ${amount} ב-${day}`,
        refundedLine: (amount: string, date: string) =>
          `הוחזר ${amount} ב-${date}`,
        reference: (value: string) => `אסמכתה: ${value}`,
        couple: "זוגי",
        // Story 3.16: an active credit's alternatives and Tal's two
        // actions on it.
        optionsTitle: "מפגשים חלופיים",
        // "בראנץ׳ {concept} · {weekday} {DD.MM}".
        optionLine: (concept: string, day: string) =>
          `בראנץ׳ ${concept} · ${day}`,
        exhausted:
          "כל המפגשים החלופיים עברו. אפשר להוסיף מפגשים ב״שינוי חלופות״",
        // A credit that funds a confirmed booking (moving it keeps the
        // credit in use): "{inUseLead}<the session, a link>{inUseTail}", or
        // inUse when the booking is not known.
        inUse:
          "הזיכוי משמש להרשמה עתידית. כדי לשנות אותו צריך קודם לבטל את ההרשמה",
        inUseLead: "הזיכוי משמש להרשמה ל:",
        inUseTail: "כדי לשנות אותו צריך קודם לבטל את ההרשמה.",
        change: "שינוי חלופות",
        refund: "החזר במקום זיכוי",
        changeFor: (title: string) => `שינוי חלופות: ${title}`,
        refundFor: (title: string) => `החזר במקום זיכוי: ${title}`,
        // The edit box of "שינוי חלופות".
        editHint: "אפשר להחליף מפגשים או להוסיף עוד",
        noCandidates: "אין כרגע מפגשים מתאימים עם מקום פנוי",
        pickOne: "צריך לבחור לפחות מפגש אחד",
        pickMax: "אפשר לבחור עד 10 מפגשים",
        reason: "סיבה (לא חובה)",
        next: "המשך",
        cancel: "ביטול",
        // The dialogs.
        customer: "לקוחה",
        creditRow: "זיכוי",
        // The change dialog: the sessions it adds, and those it removes.
        added: "מפגשים שנוספו",
        removed: "מפגשים שהוסרו",
        amount: "סכום ההחזר",
        reasonRow: "סיבה",
        changeDescription:
          "הלקוחה תוכל להירשם עם הזיכוי רק למפגשים שבחרת, ותקבל הודעה על העדכון.",
        refundDescription:
          "הזיכוי ייסגר ותיפתח בקשת החזר שתופיע בתשלומים וב״לטיפול״. הלקוחה תקבל הודעה.",
        changeCheckbox: (name: string) =>
          `אני מאשרת לשנות את החלופות של הזיכוי של ${name}`,
        refundCheckbox: (amount: string, name: string) =>
          `אני מאשרת להחליף את הזיכוי של ${name} בהחזר של ${amount}`,
        changeConfirm: "שינוי החלופות",
        refundConfirm: "פתיחת בקשת החזר",
        changeDone: "החלופות עודכנו והלקוחה קיבלה הודעה",
        refundDone: "נפתחה בקשת החזר והלקוחה קיבלה הודעה",
        // A refusal of INVALID_INPUT, by detail.field.
        refusal: {
          events:
            "אחד המפגשים כבר לא מתאים (מלא, נסגר או שהיא רשומה אליו). כדאי לרענן את הדף",
          reason: "הסיבה ארוכה מדי",
        } as Record<string, string>,
        noChange: "אלה כבר המפגשים החלופיים של הזיכוי",
        // The booking history: a cancelled booking's credit.
        creditLink: "לזיכוי",
      },
      // "נוצלו 2 · שוריינו 1 · פנויות 1"
      balanceSummary: (used: number, booked: number, free: number) =>
        `נוצלו ${used} · שוריינו ${booked} · פנויות ${free}`,
      validUntil: (dayMonth: string) => `בתוקף עד ${dayMonth}`,
      // Story 3.13: after the expiry, when a correction extended it.
      extended: "(כולל הארכה)",
      // The card's page (story 3.13): the whole plate is the link, named
      // by this.
      entitlementLinkFor: (product: string) => `פרטים ותיקונים: ${product}`,
      expiring: "עומדת לפוג",
      expired: "פגה",
      usedUp: "נוצלה",
      // A revoked or refunded entitlement.
      cancelled: "בוטלה",
      // The disclosure of a card's entries, one line each.
      entriesToggle: "פירוט הכניסות",
      // Like the customer's log (user decision 2026-10-08): the state and
      // the session's day, its title under it.
      entryUsed: (day: string) => `השתתפה · ${day}`,
      entryBooked: (day: string) => `נרשמה · ${day}`,
      entryFree: "פנויה, יש לשריין",
      entryUnused: "לא נוצלה",
      // A single entitlement (second phone check, 2026-10-07): its booked
      // session, or a reminder to book.
      singleBooked: (concept: string, day: string) =>
        `בראנץ׳ ${concept} · ${day}`,
      singleToBook: (dayMonth: string) => `יש לשריין · בתוקף עד ${dayMonth}`,
      history: "היסטוריה",
      bookingsLink: (n: number) => `היסטוריית הרשמות (${n})`,
      purchasesLink: (n: number) => `היסטוריית רכישות (${n})`,
      bookingsTitle: "היסטוריית הרשמות",
      purchasesTitle: "היסטוריית רכישות",
      backToCard: "חזרה לכרטיס",
      noBookings: "אין הרשמות",
      bookingStatus: {
        confirmed: "רשומה",
        completed: "השתתפה",
        cancelled: "בוטלה",
      },
      couple: "זוגי",
      noPurchases: "אין רכישות",
      // "{amount} · {method} · {DD.MM.YY}" under the product.
      purchaseDetail: (amount: string, method: string, paidOn: string) =>
        [amount, method, paidOn].filter(Boolean).join(" · "),
      voided: "בוטלה",
      notes: "הערות פנימיות",
      notesHint: "רק לך, הלקוחה לא רואה",
      noNotes: "אין הערות",
      noteLabel: "הערה חדשה",
      addNote: "הוספת הערה",
      noteAdded: "ההערה נוספה",
      deleteNote: "מחיקה",
      deleteQuestion: "למחוק את ההערה?",
      delete: "מחיקה",
      cancel: "ביטול",
      noteDeleted: "ההערה נמחקה",
      noteTooLong: (max: number) => `אפשר עד ${max} תווים`,
      // The account section (story 2.8): email and phone change through
      // Tal, and the reset link she sends herself.
      account: {
        // The pencils after the email and the phone in "פרטים" (fix 9).
        editEmail: "עריכת המייל",
        editPhone: "עריכת הטלפון",
        changeEmail: "שינוי מייל",
        emailChanged: "המייל עודכן. מעכשיו נכנסים איתו",
        changePhone: "שינוי מספר טלפון",
        // The field's name in the "old ← new" line.
        phone: "טלפון",
        phoneChanged: "המספר עודכן",
        resetReady: "קישור האיפוס מוכן לשליחה",
        // A repeat with the same key: the raw link is returned only once.
        resetNotShown:
          "הקישור כבר הופק, ואי אפשר להציג אותו שוב. אפשר להפיק קישור חלופי",
        issueReset: "הפקת קישור איפוס",
        emailChangeStuck:
          "שינוי המייל לא הושלם. כדי לסיים, שמרי שוב את המייל החדש",
      },
    },
    // The CSV export (story 4.4, CAP-25, user decisions 2026-10-13): a
    // bottom sheet with the scope and the closed column list. `headers` are
    // the file's header row, keyed by lib/admin/customer-export.ts.
    export: {
      button: "ייצוא",
      title: "ייצוא לקוחות",
      // The legends of the two groups in the sheet.
      scopeLegend: "מה לייצא",
      columnsLegend: "עמודות",
      scopeAll: "כל הלקוחות",
      scopeSearch: (count: string) => `תוצאות החיפוש (${count})`,
      // The shown count when the list has more than its limit.
      moreThan: (limit: number) => `${limit}+`,
      headers: exportHeaders,
      noColumns: "יש לבחור לפחות עמודה אחת",
      done: "הקובץ ירד",
    },
  },
  // /admin/notes (story 4.11, CAP-39): topics and free notes, admin only.
  notes: {
    title: "רשימות",
    topicsNav: "נושאים",
    addTopic: "+ נושא",
    addNote: "+ פתק",
    emptyTopics: "עוד אין נושאים. נושא הוא מקום לרעיונות, ספקים או מתעניינות.",
    emptyNotes: "אין פתקים בנושא הזה.",
    topicName: "שם הנושא",
    noteBody: "פתק",
    moveTo: "העברה לנושא",
    done: "בוצע",
    pin: "נעיצה",
    unpin: "ביטול נעיצה",
    pinned: "נעוץ",
    archive: "לארכיון",
    showArchive: "להציג ארכיון",
    hideArchive: "להסתיר ארכיון",
    archiveTitle: "ארכיון",
    noArchive: "אין פתקים בארכיון.",
    restore: "החזרה",
    restoreNamed: (body: string) => `החזרה של ${body}`,
    delete: "מחיקה",
    rename: "שינוי שם",
    add: "הוספה",
    save: "שמירה",
    cancel: "ביטול",
    edit: "עריכה",
    editTopic: (name: string) => `עריכת הנושא ${name}`,
    editNote: (body: string) => `עריכת הפתק ${body}`,
    noteSheet: "עריכת פתק",
    deleteNote: "מחיקת הפתק",
    deleteNoteQuestion: "למחוק את הפתק? אי אפשר להחזיר אותו.",
    deleteTopic: "מחיקת הנושא",
    deleteEmptyTopicQuestion: "למחוק את הנושא?",
    // The sensitive dialog of a topic with notes (its question is in
    // lib/admin/sensitive-actions.ts › delete_note_topic).
    deleteTopicDescription: "הנושא והפתקים שבו יימחקו, ואי אפשר להחזיר אותם.",
    impactTopic: "נושא",
    impactNotes: "פתקים",
    impactNotesValue: (n: number) =>
      n === 1
        ? "פתק אחד יימחק, כולל פתקים בארכיון"
        : `${n} פתקים יימחקו, כולל פתקים בארכיון`,
    deleteTopicCheckbox: (name: string) =>
      `הבנתי שהנושא ${name} וכל הפתקים שבו יימחקו`,
    // Results (inline-notice and the live region).
    topicAdded: "הנושא נוסף",
    topicRenamed: "השם נשמר",
    topicDeleted: "הנושא נמחק",
    noteAdded: "הפתק נוסף",
    noteSaved: "הפתק נשמר",
    noteMoved: (topic: string) => `הפתק הועבר לנושא ${topic}`,
    notePinned: "הפתק ננעץ",
    noteUnpinned: "הנעיצה בוטלה",
    noteArchived: "הפתק הועבר לארכיון",
    noteRestored: "הפתק הוחזר",
    noteDeleted: "הפתק נמחק",
    markedDone: "סומן כבוצע",
    markedNotDone: "הסימון בוטל",
    moved: (position: number, total: number) =>
      `עכשיו במקום ${position} מתוך ${total}`,
  },
  // /admin/audit (story 4.5, CAP-26, Flow 9): the audit log, read only.
  audit: {
    title: "יומן פעולות",
    filtersLabel: "סינון היומן",
    session: "מפגש",
    allSessions: "כל המפגשים",
    // "{קונספט} · {date}"
    sessionOption: (concept: string, date: string) => `${concept} · ${date}`,
    customer: "לקוחה",
    customerSearch: "חיפוש לקוחה לפי שם או טלפון",
    customerSearchHint: "התוצאות מופיעות אחרי שתי אותיות או ספרות",
    customerNone: "לא נמצאו לקוחות",
    chooseCustomer: (name: string) => `סינון לפי ${name}`,
    clearCustomer: "ניקוי",
    from: "מתאריך",
    to: "עד תאריך",
    clearFilters: "ניקוי סינון",
    // The filters' toggle on the phone: "סינון", or "סינון (2)" with two on.
    filterButton: (count: number) => (count > 0 ? `סינון (${count})` : "סינון"),
    // The closed panel's line: "מסונן: {מפגש} · {לקוחה} · {dates}".
    summary: (parts: string) => `מסונן: ${parts}`,
    dateRange: (from: string, to: string) => `${from} עד ${to}`,
    // allowed_weekdays, 0 = Sunday.
    weekdays: ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"] as readonly string[],
    empty: "אין פעולות בטווח הזה",
    loadMore: "טעינת עוד",
    // The date inputs' own errors (INVALID_INPUT, detail.field).
    rangeTo: "תאריך הסיום לפני תאריך ההתחלה",
    rangeFrom: "אפשר לבחור טווח של עד שנה",
    // The table's headers (desktop).
    columns: {
      when: "מתי",
      who: "מי",
      action: "פעולה",
      about: "על מה",
      details: "פרטים",
      reason: "סיבה",
    },
    // Who, by actor_kind (user decision 2026-10-10).
    actors: {
      admin: "טל",
      customer: "הלקוחה",
      system: "המערכת",
    } as Record<string, string>,
    anonymous: "לקוחה שפרטיה הוסרו",
    // "{date} · {hour}"
    when: (date: string, time: string) => `${date} · ${time}`,
    // "בראנץ׳ {קונספט} {DD.MM}"
    sessionLabel: (concept: string, dayMonth: string) =>
      `בראנץ׳ ${concept} ${dayMonth}`,
    reason: (text: string) => `סיבה: ${text}`,
    // A content section: "{עמוד} · {מקטע}".
    subjectSection: (page: string, section: string) => `${page} · ${section}`,
    // An edited field: "{שדה}: {ערך חדש} (במקום {ערך קודם})"; one form for
    // every field's gender and number. An added value has no "(במקום …)".
    changed: (field: string, after: string, before: string) =>
      `${field}: ${after} (במקום ${before})`,
    added: (field: string, after: string) => `${field}: ${after}`,
    // One result sentence per shown action (lib/copy/audit-actions.ts).
    results: {
      paid: (amount: string, product: string) =>
        `שולמו ${amount} על ${product}`,
      paidAmount: (amount: string) => `שולמו ${amount}`,
      refunded: (amount: string) => `הוחזרו ${amount}`,
      refundedPartial: (part: string, whole: string) =>
        `הוחזרו ${part} מתוך ${whole}`,
      booked: (places: number) =>
        places > 1 ? `נרשמה (${places} מקומות)` : "נרשמה",
      refundOpened: "נפתחה בקשת החזר",
      creditReturned: "הזיכוי חזר ללקוחה",
      credit: (sessions: number) =>
        sessions === 1
          ? "התקבל זיכוי למפגש אחד"
          : sessions === 2
            ? "התקבל זיכוי לשני מפגשים"
            : `התקבל זיכוי ל-${sessions} מפגשים`,
      backToCard: "הכניסה חזרה לכרטיסייה",
      choseRefund: "נבחר החזר, נפתחה בקשת החזר",
      choseCredit: "נבחר זיכוי",
      bookingsCancelled: (count: number) =>
        count === 1 ? "בוטלה הרשמה אחת" : `בוטלו ${count} הרשמות`,
      creditOptionsRemoved: (count: number) =>
        count === 1 ? "הוסרה חלופת זיכוי אחת" : `הוסרו ${count} חלופות זיכוי`,
      link: (purpose: string, date: string) =>
        `קישור ${purpose}, בתוקף עד ${date}`,
      linkPurposes: {
        join: "להצטרפות",
        claim: "לצירוף לחשבון קיים",
        reset: "לאיפוס סיסמה",
      } as Record<string, string>,
      emailChanged: "המייל עודכן",
      emailTaken: "המייל לא עודכן: הוא כבר שייך לחשבון אחר",
      phoneChanged: "מספר הטלפון עודכן",
      phoneTaken: "מספר הטלפון לא עודכן: הוא כבר שייך לחשבון אחר",
      exported: (count: number) =>
        count === 1 ? "יוצאה לקוחה אחת" : `יוצאו ${count} לקוחות`,
      consentGiven: "אישרה",
      consentWithdrawn: "ביטלה את האישור",
      archived: "הועבר לארכיון",
      unarchived: "הוחזר מהארכיון",
      // A moved booking: "הועברה מבראנץ׳ {קונספט} {DD.MM}".
      movedFrom: (session: string) => `הועברה מ${session}`,
      unitsAdded: (count: number) =>
        count === 1 ? "נוספה כניסה אחת" : `נוספו ${count} כניסות`,
      unitsRemoved: (count: number) =>
        count === 1 ? "הופחתה כניסה אחת" : `הופחתו ${count} כניסות`,
      parkedSettled: "התקבל זיכוי, והלקוחה תבחר בין זיכוי להחזר",
      // Story 3.14: one row per extended week.
      autoExtended: "הכרטיסייה הוארכה בשבוע, כי לא היה בראנץ׳ מתאים",
      // Story 3.16.
      creditOptionsChanged: "החלופות לזיכוי עודכנו",
      creditRefunded: (amount: string) =>
        `הזיכוי הוחלף בבקשת החזר של ${amount}`,
    },
    // Values.
    masked: "השתנה",
    yes: "כן",
    no: "לא",
    none: "—",
    // Every shown action (lib/copy/audit-actions.ts); the hidden ones are
    // never listed. An unknown one shows its code.
    actions: {
      admin_add_customer_note: "הוספת הערה פנימית",
      admin_delete_customer_note: "מחיקת הערה פנימית",
      admin_create_concept: "יצירת קונספט",
      admin_update_concept: "עריכת קונספט",
      admin_delete_concept: "מחיקת קונספט",
      admin_set_concept_archived: "העברת קונספט לארכיון",
      admin_create_event: "יצירת מפגש",
      admin_update_event: "עריכת מפגש",
      admin_publish_event: "פרסום מפגש",
      admin_duplicate_event: "שכפול מפגש",
      admin_create_product: "יצירת מוצר",
      admin_update_product: "עריכת מוצר",
      admin_set_product_price: "שינוי מחיר מוצר",
      admin_publish_content: "פרסום תוכן",
      admin_update_business_settings: "שינוי הגדרות",
      admin_export_customers: "ייצוא לקוחות",
      admin_update_notification_template: "עריכת תבנית התראה",
      admin_issue_link: "הפקת קישור",
      admin_finish_email_change: "שינוי מייל",
      admin_change_phone: "שינוי מספר טלפון",
      revoke_link: "ביטול קישור",
      approve_payment: "אישור תשלום",
      admin_book_customer: "רישום לקוחה למפגש",
      admin_cancel_booking: "ביטול הרשמה",
      admin_move_booking: "הזזת הרשמה",
      admin_complete_refund: "אישור החזר",
      admin_cancel_event: "ביטול מפגש",
      admin_delete_event: "מחיקת מפגש",
      admin_reschedule_event: "שינוי מועד מפגש",
      // Story 3.13.
      admin_correct_entitlement: "תיקון בכרטיסייה",
      admin_settle_parked_purchase: "הצעת החזר או זיכוי על מפגש שבוטל",
      admin_set_correction_booking_handled: "סימון הרשמה שטופלה אחרי תיקון",
      // Story 3.14.
      job_auto_extend: "הארכה אוטומטית",
      // Story 3.16.
      admin_change_credit_options: "שינוי חלופות לזיכוי",
      admin_refund_credit: "החזר במקום זיכוי",
      choose_credit_outcome: "בחירה בין זיכוי להחזר",
      bind_purchase: "שיוך רכישה",
      join_complete: "השלמת הצטרפות",
      set_photo_consent: "אישור תמונות אווירה",
      set_personal_photo_consent: "אישור תמונות אישיות",
      book_session: "הרשמה למפגש",
      book_sessions: "הרשמה למפגשים",
      cancel_booking: "ביטול הרשמה",
      move_booking: "הזזת הרשמה",
      complete_event: "סיום מפגש",
      reset_complete: "איפוס סיסמה",
    } as Record<string, string>,
    // Common keys of before/after; an unknown key shows its code.
    fields: {
      capacity_adults: "מכסה",
      status: "סטטוס",
      kind: "סוג",
      description: "תיאור",
      starts_at: "התחלה",
      ends_at: "סיום",
      registration_closes_at: "סגירת הרשמה",
      registration_close_overridden: "סגירת הרשמה ידנית",
      display_price_agorot: "מחיר תצוגה",
      revision: "גרסה",
      full_name: "שם מלא",
      phone_e164: "טלפון",
      email: "מייל",
      pending_email: "מייל ממתין",
      dietary_notes: "תזונה ואלרגיות",
      photo_consent: "אישור תמונות אווירה",
      photo_consent_at: "מועד אישור תמונות אווירה",
      personal_photo_consent: "אישור תמונות אישיות",
      personal_photo_consent_at: "מועד אישור תמונות אישיות",
      activated_at: "מועד הפעלה",
      anonymized_at: "מועד הסרת הפרטים",
      name: "שם",
      birth_date: "תאריך לידה",
      body: "תוכן",
      title: "כותרת",
      pinned: "נעוץ",
      done: "בוצע",
      bought: "נקנה",
      quantity: "כמות",
      archived_at: "מועד העברה לארכיון",
      day_offset: "יום הכנה",
      prep_days: "ימי הכנה",
      state: "מצב",
      purpose: "מטרה",
      expires_at: "בתוקף עד",
      consumed_at: "מועד מימוש",
      revoked_at: "מועד ביטול",
      bound_at: "מועד שיוך",
      conflict_reason: "סיבת התנגשות",
      amount_agorot: "סכום",
      price_agorot: "מחיר",
      paid_on: "תאריך תשלום",
      reference: "אסמכתה",
      note: "הערה",
      amount_override_reason: "סיבת שינוי הסכום",
      source: "מקור",
      units: "כניסות",
      original_units: "כניסות במקור",
      valid_from: "בתוקף מתאריך",
      expires_on: "בתוקף עד",
      validity_mode: "סוג תוקף",
      validity_days: "ימי תוקף",
      allowed_weekdays: "ימים מותרים",
      eligible_event_kind: "סוג מפגש",
      party_size: "מספר משתתפות",
      intro_only: "היכרות בלבד",
      active: "פעיל",
      hidden: "מוסתר",
      type: "סוג מוצר",
      booked_by: "נרשמה על ידי",
      confirmed_at: "מועד אישור",
      cancelled_at: "מועד ביטול",
      // Story 3.10: the booking a moved booking became.
      moved_to_booking_id: "הועברה להרשמה",
      // Story 3.9: a refund request's completion.
      refunded_on: "תאריך ההחזר",
      requested_at: "מועד הבקשה",
      // A cancellation credit (3.7, 3.8).
      choice_pending: "ממתינה לבחירה",
      event_kind: "סוג מפגש",
      monetary_basis_agorot: "שווי",
      options_count: "מספר מפגשים חלופיים",
      origin_starts_at: "מועד המפגש שבוטל",
      original_cancelled_at: "מועד הביטול",
      result: "תוצאה",
      completed_at: "מועד השלמה",
      alt_text: "טקסט חלופי",
      publish_state: "מצב פרסום",
      published_at: "מועד פרסום",
      draft_content: "טיוטה",
      published_content: "תוכן שפורסם",
      default_validity_days: "תוקף למוצר חדש (ימים)",
      registration_close_days_before: "סגירת הרשמה (ימים לפני)",
      registration_close_local_time: "שעת סגירת הרשמה",
      default_capacity_regular: "מכסה למפגש רגיל",
      default_capacity_couple: "מכסה למפגש זוגי",
      cancel_window_hours: "חלון ביטול (שעות)",
      credit_options_count: "חלופות לזיכוי",
      reminder_lead_hours: "תזכורת לפני מפגש (שעות)",
      admin_expiring_days: '"עומדת לפוג" אצלך (ימים)',
      customer_expiring_days: '"עומדת לפוג" אצל הלקוחה (ימים)',
      last_places_threshold: "סף מקומות אחרונים",
      default_prep_days: "ימי הכנה כברירת מחדל",
      default_session_start_time: "שעת התחלה",
      default_session_end_time: "שעת סיום",
      default_kind: "סוג ברירת מחדל",
      theme_key: "ערכת צבעים",
      generic_paper_key: "רקע",
      deleted_tasks: "משימות שנמחקו",
      guest_details: "פרטי מלווה",
      note_count: "מספר פתקים",
      payer_label: "שם המשלמת",
      post_join_button_label: "כפתור אחרי הצטרפות",
      post_join_message: "הודעה אחרי הצטרפות",
      privacy_consent_at: "מועד אישור מדיניות הפרטיות",
      // A card correction (story 3.13): the adjust movement and "טופל".
      action: "סוג תנועה",
      reason: "סיבה",
      handled_at: "מועד טיפול",
      // The customers export (story 4.4).
      scope: "היקף",
      columns: "עמודות",
      row_count: "מספר שורות",
    } as Record<string, string>,
    // Known values of code columns (their CHECK constraints), per key; an
    // unknown value shows its code.
    values: {
      status: {
        draft: "טיוטה",
        published: "פורסם",
        cancelled: "בוטל",
        completed: "הסתיים",
        confirmed: "רשומה",
        active: "פעילה",
        revoked: "בוטלה",
        refunded: "הוחזר",
        refund_requested: "ממתין להחזר",
        approved: "אושר",
        voided: "בוטל",
      },
      state: {
        pending: "ממתין",
        awaiting_login: "ממתין להתחברות",
        claiming: "בשיוך",
        consumed: "מומש",
        revoked: "בוטל",
        conflict: "התנגשות",
      },
      kind: {
        regular: "רגיל",
        couple: "זוגי",
        single: "כניסה בודדת",
        intro: "היכרות",
        card: "כרטיסייה",
      },
      type: {
        single: "כניסה בודדת",
        intro: "היכרות",
        card: "כרטיסייה",
        couple: "זוגי",
      },
      purpose: {
        join: "הצטרפות",
        claim: "צירוף לחשבון קיים",
        reset: "איפוס סיסמה",
      },
      source: { manual: "ידני", online: "אונליין" },
      // An entitlement movement (story 3.13: Tal's balance fix is adjust).
      action: {
        grant: "רכישה",
        opening_balance: "יתרת פתיחה",
        reserve: "שריון",
        release: "שחרור",
        use: "ניצול",
        adjust: "תיקון",
      },
      booked_by: { customer: "הלקוחה", admin: "טל", system: "המערכת" },
      publish_state: {
        draft: "טיוטה",
        copying: "בהעתקה",
        published: "פורסמה",
        hidden: "מוסתרת",
      },
      validity_mode: { days: "לפי ימים", session: "למפגש מסוים" },
      eligible_event_kind: { regular: "רגיל", couple: "זוגי" },
      default_kind: { regular: "רגיל", couple: "זוגי" },
      scope: { all: "כל הלקוחות", search: "תוצאות חיפוש" },
      columns: exportHeaders,
    } as Record<string, Record<string, string>>,
    // A table's own wording of a code value (gender and meaning), by
    // entity_type then key; it wins over values above.
    valuesByEntity: {
      events: {
        status: {
          draft: "טיוטה",
          published: "פורסם",
          cancelled: "בוטל",
          completed: "התקיים",
        },
      },
      bookings: {
        status: {
          confirmed: "רשומה",
          cancelled: "בוטלה",
          completed: "התקיימה",
        },
      },
      entitlements: {
        status: { active: "פעילה", revoked: "בוטלה", refunded: "הוחזרה" },
      },
      payments: { status: { approved: "אושר", voided: "בוטל" } },
      cancellation_credits: {
        status: {
          active: "פעיל",
          used: "נוצל",
          refund_requested: "ממתין להחזר",
          refunded: "הוחזר",
        },
      },
      refund_requests: {
        status: { requested: "פתוחה", completed: "הוחזר" },
      },
    } as Record<string, Record<string, Record<string, string>>>,
  },
} as const
