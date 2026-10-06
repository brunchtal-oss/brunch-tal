// System microcopy of the admin screens. Amounts arrive formatted by
// lib/money.ts ("472 ₪"), dates by lib/time.ts.

export const adminCopy = {
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
      invalid: "הערך לא תקין",
    },
    // A saved draft that does not pass the schema (edited elsewhere).
    draftInvalid: "בטיוטה השמורה יש שדה לא תקין. כדאי לתקן ולשמור שוב",
    hero: {
      title: "כותרת",
      description: "תיאור (לא חובה)",
    },
    // text_block (story 5.3).
    textBlock: {
      eyebrow: "שורה קטנה מעל הכותרת (לא חובה)",
      title: "כותרת",
      body: "טקסט",
      bodyOptional: "טקסט (לא חובה)",
    },
    // The title of a list section (steps, faq, testimonials).
    listTitle: "כותרת הסקשן (לא חובה)",
    steps: {
      item: (n: number) => `שלב ${n}`,
      add: "הוספת שלב",
      title: "שם השלב",
      body: "הסבר",
    },
    faq: {
      item: (n: number) => `שאלה ${n}`,
      add: "הוספת שאלה",
      question: "שאלה",
      answer: "תשובה",
    },
    testimonials: {
      item: (n: number) => `המלצה ${n}`,
      add: "הוספת המלצה",
      name: "שם לתצוגה",
      text: "טקסט ההמלצה",
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
    },
    // The image of a block (hero, about).
    blockImage: "תמונה (לא חובה)",
    heroImageHint: "מוצגת מאחורי הכותרת, בגובה המסך",
    footerLinks: {
      item: (n: number) => `קישור ${n}`,
      add: "הוספת קישור",
      label: "שם לתצוגה",
      labelHint: "למשל: אינסטגרם",
      url: "כתובת",
      urlHint: "מתחילה ב-https://. הקישור ייפתח בחלון חדש",
    },
    photoConsent: {
      question: "השאלה",
      questionHint: "כל שורה תוצג בשורה משלה",
      yes: "תשובת ההסכמה",
      no: "תשובת הסירוב",
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
  // /admin/sessions (story 3.1, wording approved by the user on 2026-10-04).
  sessions: {
    title: "מפגשים",
    add: "מפגש חדש",
    // The title of a session is always the concept's name (no events.title).
    sessionTitle: (concept: string) => `בראנץ׳ ${concept}`,
    status: { draft: "טיוטה", published: "פורסם" },
    places: (n: number) => `${n} מקומות`,
    empty: 'אין מפגשים קרובים. "מפגש חדש" יוצר את הראשון',
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
    morningView: "למבט בוקר המפגש",
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
    // "({n}/{n})" when every place is taken; a couple session with one place
    // left is full too.
    full: (occupied: number, capacity: number) =>
      `המפגש מלא (${occupied}/${capacity})`,
    raiseCapacity: "להעלות את המכסה",
    addPayment: "הוספת תשלום",
    willUse: (product: string, expiresOn: string) =>
      `ינוצל: כניסה מ${product}, בתוקף עד ${expiresOn}`,
    bookCustomer: (name: string) => `לרשום את ${name}`,
    booked: (name: string) => `${name} נרשמה למפגש`,
    bookAnother: "רישום לקוחה נוספת",
    chooseSession: "בחירת מפגש",
    noBookableSessions: "אין מפגש פתוח לרישום",
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
      returnsPinned: (n: number, until: string) =>
        `כניסה לאחד מ-${n} המפגשים המתאימים הבאים, עד ${until}`,
      returnsAwaiting: (n: number) =>
        `כניסה לאחד מ-${n} המפגשים המתאימים הבאים (ממתינה לפרסום מפגשים)`,
      withinWindow: "ההרשמה בתוך חלון הביטול, והלקוחה לא יכולה לבטל אותה בעצמה",
      reason: "סיבה (לא חובה)",
      checkbox: (name: string) =>
        `אני מאשרת את ביטול ההרשמה של ${name}, ושהביטול יירשם ביומן הפעולות`,
      confirm: "ביטול ההרשמה",
      done: (name: string) => `ההרשמה של ${name} בוטלה והמקום התפנה`,
    },
    // A refusal of the cancellation, worded for Tal; any other code keeps
    // errorMessage.
    cancelRefusal: {
      MANUAL_HANDLING_REQUIRED:
        "ההרשמה מומנה משני סוגי כניסה, ולכן את הביטול שלה עושים ידנית",
      BOOKING_NOT_CANCELLABLE: "ההרשמה כבר לא פעילה. כדאי לרענן את הדף",
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
    nextSession: "המפגש הבא",
    sessionDetails: "לפרטי המפגש",
    upcoming: "מפגשים קרובים",
    // "בראנץ׳ {concept} · {יום DD.MM} · {occupied}/{capacity}"
    upcomingRow: (
      concept: string,
      day: string,
      occupied: number,
      capacity: number
    ) => `בראנץ׳ ${concept} · ${day} · ${occupied}/${capacity}`,
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
  },
} as const
